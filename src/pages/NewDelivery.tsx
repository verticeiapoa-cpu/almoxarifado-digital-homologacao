import React, { useState, useRef, useEffect } from 'react';
import { SignaturePad, SignaturePadRef } from '../components/SignaturePad';
import { Save, CheckCircle2, Download, Plus, Trash2, Repeat2, Warehouse, ArrowLeft, ArrowRight, ClipboardCheck } from 'lucide-react';
import { cn } from '../components/Layout';
import { Delivery, DeliveryItem, Employee, InventoryStock, StockMovement, TemporaryAssignment } from '../types';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import { doc, collection, query, getDocs, getDoc, where, serverTimestamp, runTransaction, updateDoc } from 'firebase/firestore';
import { queueLowStockAlert } from '../lib/stockAlerts';
import { logError, logWarning } from '../lib/logger';

const MAX_DELIVERY_ITEMS = 5;

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function localDateTimeValue(date: Date) {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

export default function NewDelivery() {
  const { user, profile, activeObraId, activeObra, isAdmin, userObras } = useAuth();
  const [date] = useState(() => localDateTimeValue(new Date()));
  const [employeeId, setEmployeeId] = useState('');
  const [stockObraId, setStockObraId] = useState(activeObraId === 'ALL' ? '' : activeObraId);
  
  const [items, setItems] = useState<DeliveryItem[]>([{ ca: '', description: '', quantity: '' }]);
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [generatedPdfBlob, setGeneratedPdfBlob] = useState<Blob | null>(null);
  const [generatedDeliveryId, setGeneratedDeliveryId] = useState<string>('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [pdfWarning, setPdfWarning] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  
  // Data from Firestore
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [assignments, setAssignments] = useState<TemporaryAssignment[]>([]);
  
  const signatureRef = useRef<SignaturePadRef>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile || !activeObraId || activeObraId === 'ALL') return;
      try {
        const [homeSnapshot, assignmentSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'employees'), where('companyId', '==', profile.companyId), where('obraId', '==', activeObraId))),
          getDocs(query(collection(db, 'temporaryAssignments'), where('companyId', '==', profile.companyId), where('hostObraId', '==', activeObraId))),
        ]);
        const now = Date.now();
        const activeAssignments = assignmentSnapshot.docs
          .map(item => ({ id: item.id, ...item.data() } as TemporaryAssignment))
          .filter(item => {
            const startsAt = item.startsAt && typeof item.startsAt === 'object' && 'toMillis' in item.startsAt ? (item.startsAt as { toMillis: () => number }).toMillis() : new Date(String(item.startsAt)).getTime();
            const endsAt = item.endsAt && typeof item.endsAt === 'object' && 'toMillis' in item.endsAt ? (item.endsAt as { toMillis: () => number }).toMillis() : new Date(String(item.endsAt)).getTime();
            return item.status === 'ACTIVE' && startsAt <= now && endsAt >= now;
          });
        setAssignments(activeAssignments);
        const visitorSnapshots = await Promise.all(activeAssignments.map(item => getDoc(doc(db, 'employees', item.employeeId))));
        const combined = new Map<string, Employee>();
        homeSnapshot.docs.forEach(item => combined.set(item.id, { id: item.id, ...item.data() } as Employee));
        visitorSnapshots.filter(item => item.exists()).forEach(item => combined.set(item.id, { id: item.id, ...item.data() } as Employee));
        setEmployees([...combined.values()]);
      } catch (err) {
        logError('delivery-setup-load-failed', err);
      }
    };
    setEmployeeId('');
    fetchData();
  }, [profile, activeObraId, isAdmin]);

  useEffect(() => {
    const fetchStock = async () => {
      if (!profile || !stockObraId) { setStocks([]); return; }
      try {
        const snapshot = await getDocs(query(collection(db, 'inventoryStock'), where('companyId', '==', profile.companyId), where('obraId', '==', stockObraId)));
        setStocks(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as InventoryStock)));
      } catch (error) {
        logError('delivery-stock-load-failed', error);
        setStocks([]);
      }
    };
    fetchStock();
  }, [profile?.companyId, stockObraId]);

  useEffect(() => {
    setStockObraId(activeObraId === 'ALL' ? '' : activeObraId);
    setItems([{ ca: '', description: '', quantity: '' }]);
  }, [activeObraId]);

  const filteredEmployees = employees.filter(emp => {
    if (!emp.isActive) return false;
    return emp.obraId === activeObraId || assignments.some(item => item.employeeId === emp.id);
  });

  const handleEmployeeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setEmployeeId(id);
    const emp = employees.find(emp => emp.id === id);
    if (emp) {
      setErrors(prev => ({ ...prev, employeeId: '' }));
    }
  };

  const addItem = () => {
    if (items.length >= MAX_DELIVERY_ITEMS) return;
    setItems([...items, { ca: '', description: '', quantity: '' }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof DeliveryItem, value: string | number) => {
    const newItems = [...items];
    if (field === 'ca') {
      const stringValue = value as string;
      newItems[index].ca = stringValue;
      const stock = stocks.find(item => item.ca === stringValue);
      if (stock) {
        newItems[index].description = stock.materialDescription;
        newItems[index].materialId = stock.materialId;
        newItems[index].stockId = stock.id;
      } else {
        delete newItems[index].materialId;
        delete newItems[index].stockId;
      }
    } else {
      newItems[index][field] = value as never;
    }
    setItems(newItems);
    setErrors(prev => ({...prev, items: ''}));
  };

  const handleMaterialSelect = (index: number, description: string) => {
    const newItems = [...items];
    newItems[index].description = description;
    
    const stock = stocks.find(item => item.materialDescription === description);
    if (stock) {
      newItems[index].ca = stock.ca || '';
      newItems[index].materialId = stock.materialId;
      newItems[index].stockId = stock.id;
    } else {
      newItems[index].ca = '';
      delete newItems[index].materialId;
      delete newItems[index].stockId;
    }
    
    setItems(newItems);
    setErrors(prev => ({...prev, items: ''}));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!employeeId) newErrors.employeeId = 'Selecione um colaborador';
    if (!stockObraId) newErrors.stockObraId = 'Selecione o estoque de saída';
    
    if (items.length === 0) {
      newErrors.items = 'Adicione pelo menos um equipamento';
    } else {
      const hasInvalidItem = items.some(item => !item.description.trim() || item.quantity === '' || item.quantity < 1);
      if (hasInvalidItem) newErrors.items = 'Preencha a descrição e quantidade de todos os itens';
      const insufficient = items.find(item => item.stockId && Number(item.quantity) > (stocks.find(stock => stock.id === item.stockId)?.quantity ?? 0));
      if (insufficient) newErrors.items = `Saldo insuficiente para ${insufficient.description}`;
    }
    
    if (!signatureRef.current || signatureRef.current.isEmpty()) newErrors.signature = 'Assinatura é obrigatória';
    if (!acceptedTerms) newErrors.consent = 'O colaborador deve confirmar o recebimento';
    if (!user) newErrors.auth = 'Usuário não autenticado';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !validate() || !user) return;

    setIsSubmitting(true);
    
    const emp = employees.find(e => e.id === employeeId);
    const stockObra = userObras.find(obra => obra.id === stockObraId);
    const temporaryAssignment = assignments.find(item => item.employeeId === employeeId);
    const isFloatingEmployee = emp?.obraId !== activeObraId;
    if (!emp || !activeObra || !stockObra || (isFloatingEmployee && !temporaryAssignment)) {
      setIsSubmitting(false);
      return;
    }

    const deliveryRef = doc(collection(db, 'deliveries'));
    const deliveryId = deliveryRef.id;
    const now = new Date().toISOString();
    const signatureUrl = signatureRef.current?.getSignatureDataUrl() || '';
    const consentText = 'Declaro que recebi os EPIs relacionados, fui orientado quanto ao uso, guarda e conservação e confirmo a assinatura feita nesta tela.';
    try {
    const signatureHash = await sha256(JSON.stringify({
      deliveryId,
      timestamp: now,
      employeeId,
      obraId: emp.obraId,
      serviceObraId: activeObra.id,
      stockObraId: stockObra.id,
      items,
      signatureUrl,
      consentText,
    }));
    
    const deliveryData = {
      id: deliveryId,
      timestamp: now,
      serverCreatedAt: serverTimestamp(),
      responsibleUser: user.displayName || user.email || 'Responsável',
      companyId: profile?.companyId || 'wselent-default',
      obraId: emp.obraId,
      employeeHomeObraId: emp.obraId,
      employeeHomeObraName: emp.obraName,
      employeeHomeObraCno: emp.obraCno || '',
      serviceObraId: activeObra.id,
      serviceObraName: activeObra.name,
      stockObraId: stockObra.id,
      stockObraName: stockObra.name,
      isFloatingEmployee,
      temporaryAssignmentId: temporaryAssignment?.id || '',
      temporaryAssignmentReason: temporaryAssignment?.reason || '',
      employeeId,
      employeeName: emp.name || 'Desconhecido',
      employeeCpf: emp.cpf || '-',
      employeeJobTitle: emp.jobTitle || '-',
      employeeObraName: emp.obraName || '-',
      employeeIsOutsourced: emp.isOutsourced || false,
      items,
      status: 'COMPLETED',
      signatureUrl,
      signatureHash,
      audit: {
        authUid: user.uid,
        authEmail: user.email || '',
        signedAt: now,
        signatureMethod: 'drawn-on-screen' as const,
        consentText,
        userAgent: navigator.userAgent.slice(0, 300),
      },
      createdAt: now,
      updatedAt: now,
      createdBy: user.uid,
    };
    
      const trackedItems = new Map<string, { stock: InventoryStock; delivered: number }>();
      for (const item of items) {
        if (!item.stockId) continue;
        const stock = stocks.find(candidate => candidate.id === item.stockId);
        if (!stock || stock.obraId !== stockObraId) throw new Error('O estoque selecionado mudou. Selecione novamente os itens.');
        const current = trackedItems.get(stock.id);
        trackedItems.set(stock.id, {
          stock,
          delivered: (current?.delivered || 0) + Number(item.quantity),
        });
      }

      const trackedEntries = [...trackedItems.values()];
      const updatedStocks: InventoryStock[] = [];
      await runTransaction(db, async transaction => {
        updatedStocks.length = 0;
        const snapshots = await Promise.all(
          trackedEntries.map(({ stock }) => transaction.get(doc(db, 'inventoryStock', stock.id)))
        );
        transaction.set(deliveryRef, deliveryData);
        snapshots.forEach((snapshot, index) => {
          if (!snapshot.exists()) throw new Error('Item removido do estoque. Atualize a lista de equipamentos.');
          const entry = trackedEntries[index];
          const currentStock = { id: snapshot.id, ...snapshot.data() } as InventoryStock;
          if (entry.delivered > currentStock.quantity) throw new Error(`Saldo insuficiente para ${currentStock.materialDescription}`);
          const nextQuantity = currentStock.quantity - entry.delivered;
          const minimum = currentStock.minimumStock;
          const remainsAboveMinimum = minimum <= 0 || nextQuantity > minimum;
          const updated: InventoryStock = {
            ...currentStock,
            quantity: nextQuantity,
            lowStockAlertSent: remainsAboveMinimum ? false : Boolean(currentStock.lowStockAlertSent),
            updatedAt: now,
          };
          transaction.update(snapshot.ref, {
            quantity: updated.quantity,
            lowStockAlertSent: updated.lowStockAlertSent,
            updatedAt: updated.updatedAt,
          });
          const movementReference = doc(collection(db, 'stockMovements'));
          const movement: StockMovement = {
            id: movementReference.id,
            companyId: profile?.companyId || 'wselent-default',
            obraId: stockObra.id,
            obraName: stockObra.name,
            materialId: currentStock.materialId,
            materialDescription: currentStock.materialDescription,
            type: 'EPI_DELIVERY',
            quantity: -entry.delivered,
            balanceBefore: currentStock.quantity,
            balanceAfter: nextQuantity,
            deliveryId,
            createdAt: now,
            createdBy: user.uid,
          };
          transaction.set(movementReference, movement);
          updatedStocks.push(updated);
        });
      });

      setGeneratedDeliveryId(deliveryId);
      setShowSuccess(true);
      setStocks(current => current.map(stock => updatedStocks.find(updated => updated.id === stock.id) || stock));

      for (const stock of updatedStocks) {
        try {
          const queued = await queueLowStockAlert(profile?.companyId || '', stock, user.uid);
          if (queued) {
            const alertAt = new Date().toISOString();
            await updateDoc(doc(db, 'inventoryStock', stock.id), {
              lowStockAlertSent: true,
              lastLowStockAlertAt: alertAt,
              updatedAt: alertAt,
            });
          }
        } catch (alertError) {
          logWarning('low-stock-alert-queue-failed', alertError);
        }
      }

      // Now fetch all transactions for this employee to build their complete Ficha
      try {
      const deliveriesQuery = query(
        collection(db, 'deliveries'),
        where('companyId', '==', profile?.companyId || ''),
        where('employeeId', '==', employeeId)
      );
      const deliveriesSnapshot = await getDocs(deliveriesQuery);
      const allDeliveries = deliveriesSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Delivery));
      
      const { generateEmployeeFicha } = await import('../utils/pdfGenerator');
      const pdfBlob = await generateEmployeeFicha(emp, allDeliveries);
      setGeneratedPdfBlob(pdfBlob);
      setGeneratedDeliveryId(deliveryId);
      
      setShowSuccess(true);
      } catch (pdfError) {
        logWarning('delivery-pdf-generation-failed', pdfError);
        setPdfWarning('Entrega e baixa de estoque confirmadas. O PDF não pôde ser gerado agora; consulte o Histórico. Não repita esta entrega.');
      }
    } catch (error) {
      logError('delivery-save-failed', error);
      const code = (error as { code?: string }).code;
      setErrors(current => ({ ...current, save: code === 'permission-denied'
        ? 'O banco recusou esta entrega. Verifique as permissões da obra e as regras publicadas. Nenhuma baixa foi confirmada.'
        : error instanceof Error ? error.message : 'Não foi possível confirmar a entrega. Verifique sua conexão antes de tentar novamente.' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadPdf = () => {
    if (generatedPdfBlob && generatedDeliveryId) {
      import('../utils/pdfGenerator').then(({ downloadPdf }) => {
        downloadPdf(generatedPdfBlob, `Ficha-EPI-${generatedDeliveryId}.pdf`);
      });
    }
  };

  const resetForm = () => {
    setEmployeeId('');
    setItems([{ ca: '', description: '', quantity: '' }]);
    signatureRef.current?.clear();
    setErrors({});
    setShowSuccess(false);
    setGeneratedPdfBlob(null);
    setGeneratedDeliveryId('');
    setAcceptedTerms(false);
    setPdfWarning('');
    setCurrentStep(1);
  };

  const continueStep = () => {
    const nextErrors: Record<string, string> = {};
    if (currentStep === 1) {
      if (!employeeId) nextErrors.employeeId = 'Selecione um colaborador';
      if (!stockObraId) nextErrors.stockObraId = 'Selecione o estoque de saída';
    }
    if (currentStep === 2) {
      if (items.length === 0) nextErrors.items = 'Adicione pelo menos um equipamento';
      if (items.some(item => !item.description.trim() || item.quantity === '' || item.quantity < 1)) {
        nextErrors.items = 'Preencha a descrição e quantidade de todos os itens';
      }
      const insufficient = items.find(item => item.stockId && Number(item.quantity) > (stocks.find(stock => stock.id === item.stockId)?.quantity ?? 0));
      if (insufficient) nextErrors.items = `Saldo insuficiente para ${insufficient.description}`;
    }
    setErrors(previous => ({ ...previous, ...nextErrors }));
    if (Object.keys(nextErrors).length === 0) setCurrentStep(step => Math.min(3, step + 1));
  };

  if (activeObraId === 'ALL' || !activeObra) {
    return <div className="work-required-card"><Warehouse /><div><strong>Selecione a obra do atendimento</strong><span>Escolha um canteiro no topo antes de registrar uma entrega.</span></div></div>;
  }

  if (showSuccess) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-2">Ficha de EPI Registrada!</h2>
        <p className="text-slate-500 mb-8 text-center max-w-sm">
          Entrega {generatedDeliveryId} registrada e estoque atualizado.
        </p>
        {pdfWarning && <p role="status" className="p-4 text-amber-800">{pdfWarning}</p>}
        <div className="flex gap-4">
          <button 
            type="button"
            onClick={handleDownloadPdf}
            disabled={!generatedPdfBlob}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            Baixar Ficha PDF
          </button>
          <button 
            type="button"
            onClick={resetForm}
            className="px-4 py-2 bg-[#2bb2c8] text-white rounded-lg font-medium hover:bg-[#2198ac] transition-colors shadow-sm"
          >
            Nova Entrega
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="delivery-page">
      <div className="delivery-heading">
        <div>
          <p className="dashboard-eyebrow">OPERAÇÃO PRINCIPAL</p>
          <h2>Nova Ficha de EPI</h2>
          <p>Registre a entrega de equipamentos de proteção e capture a assinatura.</p>
        </div>
        <ClipboardCheck className="delivery-heading-icon" />
      </div>

      <div className="delivery-context-card">
        <Warehouse />
        <div><span>Obra do atendimento</span><strong>{activeObra.name}</strong></div>
        <small>O estoque e o funcionário serão vinculados a esta operação.</small>
      </div>

      <div className="delivery-steps" aria-label="Etapas da entrega">
        {[
          ['1', 'Contexto', 'Funcionário, obra e data'],
          ['2', 'Equipamentos', 'EPI, CA e quantidade'],
          ['3', 'Confirmação', 'Revisão e assinatura'],
        ].map(([number, title, description], index) => {
          const step = index + 1;
          return <button type="button" key={number} onClick={() => step < currentStep && setCurrentStep(step)} className={cn('delivery-step', currentStep === step && 'delivery-step-active', currentStep > step && 'delivery-step-done')}>
            <span>{currentStep > step ? '✓' : number}</span><strong>{title}</strong><small>{description}</small>
          </button>;
        })}
      </div>

      <form onSubmit={handleSubmit} className="delivery-form">
        {errors.save && <p role="alert" className="p-4 bg-red-50 text-red-800">{errors.save}</p>}
        <div className="delivery-form-body">
          {currentStep === 1 && <section className="delivery-section">
            <div className="delivery-section-heading"><div><span>ETAPA 1</span><h3>Funcionário, obra e data</h3><p>Defina o contexto antes de selecionar os equipamentos.</p></div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data e Hora</label>
                <input 
                  type="datetime-local" 
                  value={date}
                  disabled
                  className="w-full px-3 py-2.5 sm:py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-500 text-sm min-h-[44px]"
                />
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    Nome do Empregado
                  </label>
                  {activeObra && (
                    <span className="text-xs text-[#2bb2c8] font-medium">
                      Filtrando: {activeObra.name}
                    </span>
                  )}
                </div>
                <select
                  value={employeeId}
                  onChange={handleEmployeeChange}
                  className={cn(
                    "w-full px-3 py-2.5 sm:py-2 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8] focus:border-transparent text-sm min-h-[44px]",
                    errors.employeeId ? "border-red-500" : "border-slate-300"
                  )}
                >
                  <option value="">Selecione um funcionário...</option>
                  {filteredEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name} ({emp.jobTitle}) - {emp.obraName}</option>
                  ))}
                </select>
                {filteredEmployees.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    Nenhum funcionário cadastrado nesta obra. Selecione outra obra no topo ou cadastre na aba "Funcionários".
                  </p>
                )}
                {errors.employeeId && <p className="mt-1 text-sm text-red-500">{errors.employeeId}</p>}
              </div>

              {employeeId && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Obra Vinculada</label>
                  <input 
                    type="text" 
                    value={employees.find(e => e.id === employeeId)?.obraName || 'Sem obra vinculada'}
                    disabled
                    className="w-full px-3 py-2.5 sm:py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-sm min-h-[44px] font-medium"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Estoque de saída *</label>
                <select value={stockObraId} onChange={event => { setStockObraId(event.target.value); setStocks([]); setItems([{ ca: '', description: '', quantity: '' }]); setErrors(current => ({ ...current, stockObraId: '' })); }} className={cn('field-control', errors.stockObraId && 'border-red-500')}>
                  <option value="">Selecione...</option>
                  {userObras.map(obra => <option key={obra.id} value={obra.id}>{obra.name}</option>)}
                </select>
                {errors.stockObraId && <p className="mt-1 text-sm text-red-500">{errors.stockObraId}</p>}
                <p className="mt-1 text-xs text-slate-500">A baixa será feita somente no estoque desta obra, sem alterar o vínculo/CNO do funcionário.</p>
              </div>
              {employeeId && employees.find(item => item.id === employeeId)?.obraId !== activeObraId && <div className="sm:col-span-2 floating-delivery-note"><Repeat2 /><div><strong>Funcionário flutuante</strong><span>O vínculo permanece em {employees.find(item => item.id === employeeId)?.obraName}. Esta entrega será registrada em {activeObra.name} e baixará o estoque selecionado.</span></div></div>}
            </div>
          </section>}

          {currentStep === 2 && <section className="delivery-section">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
              <div><span className="delivery-kicker">ETAPA 2</span><h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">Equipamentos de Proteção (EPI)</h3><p className="text-xs text-slate-500 mt-1">Selecione os EPIs, confira o CA e informe a quantidade.</p></div>
              <button
                type="button"
                onClick={addItem}
                disabled={items.length >= MAX_DELIVERY_ITEMS}
                className="flex items-center gap-1.5 text-sm font-medium text-[#2bb2c8] hover:text-[#2198ac] transition-colors p-2 -mr-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                Adicionar Item
              </button>
            </div>
            
            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={index} className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start bg-slate-50 p-4 rounded-lg border border-slate-100 relative">
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="absolute -top-2 -right-2 bg-white text-red-500 p-1.5 rounded-full border border-slate-200 shadow-sm hover:bg-red-50 transition-colors"
                      title="Remover item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">C A (Opcional)</label>
                    <input 
                      type="text" 
                      value={item.ca}
                      onChange={(e) => handleItemChange(index, 'ca', e.target.value)}
                      placeholder="Ex: 36982"
                      className="w-full px-3 py-2.5 sm:py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8] text-sm min-h-[44px]"
                    />
                  </div>

                  <div className="sm:col-span-6">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Equipamento de Proteção *</label>
                    <input
                      list={`materials-${index}`}
                      value={item.description}
                      onChange={(e) => handleMaterialSelect(index, e.target.value)}
                      placeholder="Selecione ou digite um EPI avulso"
                      className={cn(
                        "w-full px-3 py-2.5 sm:py-2 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8] text-sm min-h-[44px]",
                        !item.description && errors.items ? "border-red-500" : "border-slate-300"
                      )}
                    />
                    <datalist id={`materials-${index}`}>
                      {stocks.map(stock => (
                        <option key={stock.id} value={stock.materialDescription} label={`${stock.quantity} ${stock.unit} disponíveis${stock.ca ? ` · C.A: ${stock.ca}` : ''}`} />
                      ))}
                    </datalist>
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Quant.</label>
                    <input 
                      type="number" 
                      min="1"
                      step="1"
                      value={item.quantity || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        handleItemChange(index, 'quantity', val === '' ? '' : (parseInt(val, 10) || 1));
                      }}
                      className="w-full px-3 py-2.5 sm:py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8] text-sm min-h-[44px]"
                    />
                  </div>
                </div>
              ))}
              {errors.items && <p className="text-sm text-red-500 font-medium">{errors.items}</p>}
            </div>
          </section>}

          {currentStep === 3 && <section className="delivery-section">
            <div className="delivery-section-heading"><div><span>ETAPA 3</span><h3>Revisão, assinatura e confirmação</h3><p>Revise os dados da entrega antes de registrar a ficha.</p></div></div>
            <div className="delivery-review">
              <div><span>Funcionário</span><strong>{employees.find(item => item.id === employeeId)?.name || 'Não selecionado'}</strong></div>
              <div><span>Obra do atendimento</span><strong>{activeObra.name}</strong></div>
              <div><span>Estoque de saída</span><strong>{userObras.find(item => item.id === stockObraId)?.name || 'Não selecionado'}</strong></div>
              <div><span>Itens selecionados</span><strong>{items.length} item(ns)</strong></div>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2 flex items-center justify-between">
              <span>Assinatura do Funcionário</span>
              {errors.signature && <span className="text-xs text-red-500 normal-case font-normal">{errors.signature}</span>}
            </h3>
            
            <SignaturePad 
              ref={signatureRef} 
              onEnd={() => setErrors(prev => ({...prev, signature: ''}))}
              error={!!errors.signature}
            />
            <p className="text-xs text-slate-500 mt-2">
              A assinatura eletrônica manuscrita será vinculada aos {items.length} item(ns) listado(s) acima.
            </p>
            <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => {
                  setAcceptedTerms(event.target.checked);
                  setErrors(prev => ({ ...prev, consent: '' }));
                }}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#2bb2c8]"
              />
              <span>Declaro que recebi os EPIs relacionados, fui orientado quanto ao uso, guarda e conservação e confirmo a assinatura feita nesta tela.</span>
            </label>
            {errors.consent && <p className="mt-1 text-sm text-red-500">{errors.consent}</p>}
          </section>}

        </div>

        <div className="delivery-actions">
          {currentStep > 1 && <button type="button" onClick={() => setCurrentStep(step => step - 1)} className="secondary-action"><ArrowLeft className="w-4 h-4" />Voltar</button>}
          {currentStep < 3 ? <button type="button" onClick={continueStep} className="primary-action">Continuar <ArrowRight className="w-4 h-4" /></button> : <button type="submit" disabled={isSubmitting} className="primary-action">
            {isSubmitting ? <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Salvando Ficha...</> : <><Save className="w-5 h-5" />Salvar Ficha de EPI</>}
          </button>}
        </div>
      </form>
    </div>
  );
}
