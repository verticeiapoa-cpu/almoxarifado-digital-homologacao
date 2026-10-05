import React, { useState, useRef, useEffect } from 'react';
import { SignaturePad, SignaturePadRef } from '../components/SignaturePad';
import { Save, CheckCircle2, Download, Plus, Trash2, Repeat2, Warehouse, ArrowLeft, ArrowRight, ClipboardCheck } from 'lucide-react';
import { cn } from '../components/Layout';
import { Delivery, DeliveryItem, Employee, InventoryStock, Obra, StockMovement, TemporaryAssignment } from '../types';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebase';
import { doc, collection, query, getDocs, getDoc, getDocFromServer, where, serverTimestamp, runTransaction, updateDoc } from 'firebase/firestore';
import { queueLowStockAlert } from '../lib/stockAlerts';
import { logError, logWarning } from '../lib/logger';
import { stockDocumentId } from '../lib/inventory';

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
  const [date, setDate] = useState(() => localDateTimeValue(new Date()));
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
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [stockWarning, setStockWarning] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  
  // Data from Firestore
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [assignments, setAssignments] = useState<TemporaryAssignment[]>([]);
  
  const signatureRef = useRef<SignaturePadRef>(null);
  const confirmedFicha = useRef<{ employee: Employee; delivery: Delivery } | null>(null);
  const [setupError, setSetupError] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setDate(localDateTimeValue(new Date())), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    signatureRef.current?.clear();
    setAcceptedTerms(false);
  }, [employeeId, stockObraId, activeObraId, items]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      if (!profile || !activeObraId || activeObraId === 'ALL') return;
      setSetupLoading(true);
      setSetupError('');
      setEmployees([]);
      setAssignments([]);
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
        if (cancelled) return;
        setAssignments(activeAssignments);
        const visitorSnapshots = await Promise.all(activeAssignments.map(item => getDoc(doc(db, 'employees', item.employeeId))));
        const combined = new Map<string, Employee>();
        homeSnapshot.docs.forEach(item => combined.set(item.id, { id: item.id, ...item.data() } as Employee));
        visitorSnapshots.filter(item => item.exists()).forEach(item => combined.set(item.id, { id: item.id, ...item.data() } as Employee));
        if (!cancelled) setEmployees([...combined.values()]);
      } catch (err) {
        logError('delivery-setup-load-failed', err);
        if (!cancelled) setSetupError('Não foi possível carregar os funcionários e suas alocações. Tente novamente.');
      } finally {
        if (!cancelled) setSetupLoading(false);
      }
    };
    setEmployeeId('');
    fetchData();
    return () => { cancelled = true; };
  }, [profile?.companyId, activeObraId, reload]);

  useEffect(() => {
    let cancelled = false;
    const fetchStock = async () => {
      if (!profile || !stockObraId) { setStocks([]); return; }
      setStockLoading(true);
      setStocks([]);
      setStockWarning('');
      try {
        const snapshot = await getDocs(query(collection(db, 'inventoryStock'), where('companyId', '==', profile.companyId), where('obraId', '==', stockObraId)));
        if (cancelled) return;
        const loaded = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as InventoryStock));
        const canonical = loaded.filter(stock => stock.id === stockDocumentId(stock.obraId, stock.materialId));
        const byMaterial = new Map<string, InventoryStock>();
        canonical.forEach(stock => byMaterial.set(stock.materialId, stock));
        setStocks([...byMaterial.values()]);
        const ignored = loaded.length - canonical.length;
        setStockWarning(ignored > 0
          ? `${ignored} saldo(s) de versão antiga foram ignorados para evitar uma baixa inconsistente. Abra Estoque e salve novamente esses EPIs antes de entregá-los.`
          : '');
      } catch (error) {
        logError('delivery-stock-load-failed', error);
        if (cancelled) return;
        setStocks([]);
        setStockWarning('Não foi possível validar o estoque desta obra. Tente novamente antes de registrar uma entrega.');
      } finally {
        if (!cancelled) setStockLoading(false);
      }
    };
    fetchStock();
    return () => { cancelled = true; };
  }, [profile?.companyId, stockObraId, reload]);

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

  const handleItemChange = (index: number, field: 'quantity', value: '' | number) => {
    setItems(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
    setErrors(prev => ({ ...prev, items: '' }));
  };

  const handleMaterialSelect = (index: number, stockId: string) => {
    const stock = stocks.find(item => item.id === stockId);
    setItems(current => current.map((item, i) => i !== index ? item : stock
      ? { quantity: item.quantity, ca: stock.ca || '', description: stock.materialDescription, materialId: stock.materialId, stockId: stock.id }
      : { quantity: item.quantity, ca: '', description: '' }));
    setErrors(prev => ({ ...prev, items: '' }));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!employeeId) newErrors.employeeId = 'Selecione um colaborador';
    if (!stockObraId) newErrors.stockObraId = 'Selecione o estoque de saída';
    
    if (items.length === 0) {
      newErrors.items = 'Adicione pelo menos um equipamento';
    } else {
      const hasInvalidItem = items.some(item => {
        const quantity = Number(item.quantity);
        return !item.description.trim()
          || !item.materialId
          || !item.stockId
          || !Number.isInteger(quantity)
          || quantity < 1
          || quantity > 9999;
      });
      if (hasInvalidItem) newErrors.items = 'Selecione EPIs existentes no estoque e informe quantidades inteiras entre 1 e 9999';

      const totals = new Map<string, number>();
      items.forEach(item => {
        if (item.stockId) totals.set(item.stockId, (totals.get(item.stockId) || 0) + Number(item.quantity || 0));
      });
      const insufficientStockId = [...totals.entries()].find(([stockId, quantity]) => quantity > (stocks.find(stock => stock.id === stockId)?.quantity ?? 0))?.[0];
      if (insufficientStockId) {
        newErrors.items = `Saldo insuficiente para ${stocks.find(stock => stock.id === insufficientStockId)?.materialDescription || 'o EPI selecionado'}`;
      }
    }
    
    if (!signatureRef.current || signatureRef.current.isEmpty()) newErrors.signature = 'Assinatura é obrigatória';
    if (!acceptedTerms) newErrors.consent = 'O colaborador deve confirmar o recebimento';
    if (!user) newErrors.auth = 'Usuário não autenticado';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep !== 3) { continueStep(); return; }
    if (isSubmitting || !validate() || !user || !profile) return;

    const selectedEmployee = employees.find(item => item.id === employeeId);
    const selectedStockObra = userObras.find(obra => obra.id === stockObraId);
    if (!selectedEmployee || !activeObra || !selectedStockObra) {
      setErrors(current => ({ ...current, save: 'Os dados da entrega mudaram. Volte à primeira etapa e selecione novamente funcionário e obra.' }));
      return;
    }

    const normalizedItems: DeliveryItem[] = items.map(item => ({
      ...(item.materialId ? { materialId: item.materialId } : {}),
      ...(item.stockId ? { stockId: item.stockId } : {}),
      ca: item.ca.trim(),
      description: item.description.trim(),
      quantity: Number(item.quantity),
    }));

    for (const item of normalizedItems) {
      if (!item.materialId || !item.stockId || item.stockId !== stockDocumentId(stockObraId, item.materialId)) {
        setErrors(current => ({ ...current, save: `O saldo de ${item.description || 'um EPI'} está em formato antigo ou inconsistente. Abra Estoque, salve novamente esse item e tente a entrega outra vez.` }));
        return;
      }
    }

    setIsSubmitting(true);
    setErrors(current => ({ ...current, save: '' }));

    const deliveryRef = doc(collection(db, 'deliveries'));
    const deliveryId = deliveryRef.id;
    const now = new Date().toISOString();
    const signatureUrl = signatureRef.current?.getSignatureDataUrl() || '';
    const consentText = 'Declaro que recebi os EPIs relacionados, fui orientado quanto ao uso, guarda e conservação e confirmo a assinatura feita nesta tela.';

    try {
      if (signatureUrl.length > 850000) {
        throw new Error('A assinatura ficou grande demais para ser armazenada com segurança. Limpe a assinatura, assine novamente e tente salvar.');
      }

      const [employeeSnapshot, serviceObraSnapshot, stockObraSnapshot] = await Promise.all([
        getDocFromServer(doc(db, 'employees', employeeId)),
        getDocFromServer(doc(db, 'obras', activeObra.id)),
        getDocFromServer(doc(db, 'obras', selectedStockObra.id)),
      ]);

      if (!employeeSnapshot.exists() || !serviceObraSnapshot.exists() || !stockObraSnapshot.exists()) {
        throw new Error('Funcionário ou obra não existe mais no banco. Atualize a tela antes de tentar novamente.');
      }

      const emp = { id: employeeSnapshot.id, ...employeeSnapshot.data() } as Employee;
      const serviceObra = { id: serviceObraSnapshot.id, ...serviceObraSnapshot.data() } as Obra;
      const stockObra = { id: stockObraSnapshot.id, ...stockObraSnapshot.data() } as Obra;

      if (emp.companyId !== profile.companyId || serviceObra.companyId !== profile.companyId || stockObra.companyId !== profile.companyId) {
        throw new Error('Os dados selecionados não pertencem à empresa atual.');
      }
      if (!emp.isActive) throw new Error('O funcionário foi desativado. Selecione um funcionário ativo.');
      if (!emp.name || !emp.cpf || !emp.jobTitle || !emp.obraId || !emp.obraName || typeof emp.isOutsourced !== 'boolean') {
        throw new Error('O cadastro do funcionário está incompleto. Corrija nome, CPF, função e obra de vínculo antes da entrega.');
      }
      if (!serviceObra.name || !stockObra.name) {
        throw new Error('O cadastro da obra está incompleto. Revise a obra antes da entrega.');
      }

      const isFloatingEmployee = emp.obraId !== serviceObra.id;
      let temporaryAssignment: TemporaryAssignment | undefined;
      if (isFloatingEmployee) {
        const cachedAssignment = assignments.find(item => item.employeeId === employeeId && item.hostObraId === serviceObra.id);
        if (!cachedAssignment) throw new Error('Este funcionário não possui uma alocação temporária ativa para a obra do atendimento.');

        const assignmentSnapshot = await getDocFromServer(doc(db, 'temporaryAssignments', cachedAssignment.id));
        if (!assignmentSnapshot.exists()) throw new Error('A alocação temporária não existe mais. Atualize a tela.');
        temporaryAssignment = { id: assignmentSnapshot.id, ...assignmentSnapshot.data() } as TemporaryAssignment;

        const startsAt = temporaryAssignment.startsAt && typeof temporaryAssignment.startsAt === 'object' && 'toMillis' in temporaryAssignment.startsAt
          ? (temporaryAssignment.startsAt as { toMillis: () => number }).toMillis()
          : new Date(String(temporaryAssignment.startsAt)).getTime();
        const endsAt = temporaryAssignment.endsAt && typeof temporaryAssignment.endsAt === 'object' && 'toMillis' in temporaryAssignment.endsAt
          ? (temporaryAssignment.endsAt as { toMillis: () => number }).toMillis()
          : new Date(String(temporaryAssignment.endsAt)).getTime();
        const currentTime = Date.now();
        if (temporaryAssignment.status !== 'ACTIVE' || temporaryAssignment.employeeId !== employeeId || temporaryAssignment.hostObraId !== serviceObra.id || startsAt > currentTime || endsAt < currentTime) {
          throw new Error('A alocação temporária expirou ou foi cancelada. Atualize a tela antes de registrar a entrega.');
        }
      }

      const signatureHash = await sha256(JSON.stringify({
        deliveryId,
        timestamp: now,
        employeeId,
        obraId: emp.obraId,
        serviceObraId: serviceObra.id,
        stockObraId: stockObra.id,
        items: normalizedItems,
        signatureUrl,
        consentText,
      }));

      const deliveryData = {
        id: deliveryId,
        timestamp: now,
        serverCreatedAt: serverTimestamp(),
        responsibleUser: user.displayName || user.email || 'Responsável',
        companyId: profile.companyId,
        obraId: emp.obraId,
        employeeHomeObraId: emp.obraId,
        employeeHomeObraName: emp.obraName,
        employeeHomeObraCno: emp.obraCno || '',
        serviceObraId: serviceObra.id,
        serviceObraName: serviceObra.name,
        stockObraId: stockObra.id,
        stockObraName: stockObra.name,
        isFloatingEmployee,
        temporaryAssignmentId: temporaryAssignment?.id || '',
        temporaryAssignmentReason: temporaryAssignment?.reason || '',
        employeeId,
        employeeName: emp.name,
        employeeCpf: emp.cpf,
        employeeJobTitle: emp.jobTitle,
        employeeObraName: emp.obraName,
        employeeIsOutsourced: emp.isOutsourced,
        items: normalizedItems,
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
      for (const item of normalizedItems) {
        if (!item.stockId || !item.materialId) continue;
        const stock = stocks.find(candidate => candidate.id === item.stockId);
        if (!stock || stock.obraId !== stockObra.id || stock.id !== stockDocumentId(stockObra.id, stock.materialId)) {
          throw new Error(`O estoque de ${item.description} mudou ou precisa ser atualizado. Volte à etapa de equipamentos e selecione o item novamente.`);
        }
        const current = trackedItems.get(stock.id);
        trackedItems.set(stock.id, {
          stock,
          delivered: (current?.delivered || 0) + Number(item.quantity),
        });
      }

      const trackedEntries = [...trackedItems.values()];
      if (trackedEntries.length !== new Set(normalizedItems.map(item => item.stockId)).size) {
        throw new Error('Um ou mais EPIs não estão vinculados corretamente ao estoque.');
      }

      const updatedStocks: InventoryStock[] = [];
      await runTransaction(db, async transaction => {
        updatedStocks.length = 0;
        const snapshots = await Promise.all(
          trackedEntries.map(({ stock }) => transaction.get(doc(db, 'inventoryStock', stock.id)))
        );

        snapshots.forEach((snapshot, index) => {
          if (!snapshot.exists()) throw new Error('Item removido do estoque. Atualize a lista de equipamentos.');
          const entry = trackedEntries[index];
          const currentStock = { id: snapshot.id, ...snapshot.data() } as InventoryStock;
          if (currentStock.companyId !== profile.companyId || currentStock.obraId !== stockObra.id
            || currentStock.materialId !== entry.stock.materialId
            || currentStock.materialDescription !== entry.stock.materialDescription
            || (currentStock.ca || '') !== (entry.stock.ca || '')) {
            throw new Error('O cadastro do EPI mudou durante a revisão. Atualize o estoque e selecione os equipamentos novamente.');
          }
          if (currentStock.id !== stockDocumentId(currentStock.obraId, currentStock.materialId)) {
            throw new Error(`O saldo de ${currentStock.materialDescription} precisa ser migrado pelo administrador antes da entrega.`);
          }
          if (entry.delivered > currentStock.quantity) throw new Error(`Saldo insuficiente para ${currentStock.materialDescription}`);
        });

        transaction.set(deliveryRef, deliveryData);

        snapshots.forEach((snapshot, index) => {
          const entry = trackedEntries[index];
          const currentStock = { id: snapshot.id, ...snapshot.data() } as InventoryStock;
          const nextQuantity = currentStock.quantity - entry.delivered;
          const minimum = currentStock.minimumStock;
          const remainsAboveMinimum = minimum <= 0 || nextQuantity > minimum;
          const updated: InventoryStock = {
            id: snapshot.id,
            companyId: currentStock.companyId,
            obraId: currentStock.obraId,
            obraName: currentStock.obraName || stockObra.name,
            materialId: currentStock.materialId,
            materialDescription: currentStock.materialDescription,
            ca: currentStock.ca || '',
            quantity: nextQuantity,
            minimumStock: Number.isInteger(currentStock.minimumStock) ? currentStock.minimumStock : 0,
            unit: currentStock.unit || 'UN',
            lowStockAlertSent: remainsAboveMinimum ? false : Boolean(currentStock.lowStockAlertSent),
            ...(typeof currentStock.lastLowStockAlertAt === 'string' && currentStock.lastLowStockAlertAt
              ? { lastLowStockAlertAt: currentStock.lastLowStockAlertAt }
              : {}),
            createdAt: currentStock.createdAt || now,
            updatedAt: now,
          };
          if (isAdmin) {
            // Replace the whole stock document so records created by older
            // versions lose deprecated/null fields that current rules reject.
            transaction.set(snapshot.ref, updated);
          } else {
            transaction.update(snapshot.ref, {
              quantity: updated.quantity,
              lowStockAlertSent: updated.lowStockAlertSent,
              updatedAt: updated.updatedAt,
            });
          }
          const movementReference = doc(collection(db, 'stockMovements'));
          const movement: StockMovement = {
            id: movementReference.id,
            companyId: profile.companyId,
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

      confirmedFicha.current = { employee: emp, delivery: deliveryData as unknown as Delivery };
      setGeneratedDeliveryId(deliveryId);
      setGeneratedPdfBlob(null);
      setPdfWarning('');
      setShowSuccess(true);
      setStocks(current => current.map(stock => updatedStocks.find(updated => updated.id === stock.id) || stock));

      // Generate the just-confirmed ficha from the immutable delivery snapshot.
      // This avoids a second Firestore query and makes the PDF available even
      // when the historical query/index is temporarily unavailable.
      try {
        const { generateEmployeeFicha, downloadPdf } = await import('../utils/pdfGenerator');
        const deliveryForPdf = { ...deliveryData, id: deliveryId } as unknown as Delivery;
        const blob = await generateEmployeeFicha(emp, [deliveryForPdf]);
        setGeneratedPdfBlob(blob);
        downloadPdf(blob, `Ficha-EPI-${deliveryId}.pdf`);
      } catch (pdfError) {
        logWarning('delivery-auto-pdf-generation-failed', pdfError);
        setPdfWarning('A entrega foi salva, mas o download automático do PDF não iniciou. Use o botão Baixar PDF para tentar novamente.');
      }

      for (const stock of updatedStocks) {
        try {
          const queued = await queueLowStockAlert(profile.companyId, stock, user.uid);
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
    } catch (error) {
      logError('delivery-save-failed', error);
      const code = (error as { code?: string }).code;
      setErrors(current => ({ ...current, save: code === 'permission-denied'
        ? 'O banco recusou a entrega porque algum cadastro, saldo ou permissão não corresponde ao estado atual. Nenhuma baixa foi confirmada. Atualize a tela e confira o EPI e a obra selecionados.'
        : error instanceof Error ? error.message : 'Não foi possível confirmar a entrega. Verifique sua conexão antes de tentar novamente.' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!generatedDeliveryId || !employeeId || !profile) return;
    if (generatedPdfBlob) {
      const { downloadPdf } = await import('../utils/pdfGenerator');
      downloadPdf(generatedPdfBlob, `Ficha-EPI-${generatedDeliveryId}.pdf`);
      return;
    }

    setIsGeneratingPdf(true);
    setPdfWarning('');
    try {
      const ficha = confirmedFicha.current;
      if (!ficha) throw new Error('Consulte esta entrega no Histórico para gerar a ficha.');
      const { generateEmployeeFicha, downloadPdf } = await import('../utils/pdfGenerator');
      const blob = await generateEmployeeFicha(ficha.employee, [ficha.delivery]);
      setGeneratedPdfBlob(blob);
      downloadPdf(blob, `Ficha-EPI-${generatedDeliveryId}.pdf`);
    } catch (pdfError) {
      logWarning('delivery-pdf-generation-failed', pdfError);
      setPdfWarning(pdfError instanceof Error ? pdfError.message : 'A entrega está salva, mas o PDF não pôde ser gerado agora. Use o Histórico mais tarde.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };


  const resetForm = () => {
    confirmedFicha.current = null;
    setDate(localDateTimeValue(new Date()));
    setEmployeeId('');
    setItems([{ ca: '', description: '', quantity: '' }]);
    signatureRef.current?.clear();
    setErrors({});
    setShowSuccess(false);
    setGeneratedPdfBlob(null);
    setGeneratedDeliveryId('');
    setIsGeneratingPdf(false);
    setAcceptedTerms(false);
    setPdfWarning('');
    setCurrentStep(1);
  };

  const continueStep = () => {
    const nextErrors: Record<string, string> = {};
    if (setupLoading || stockLoading || setupError) return;
    if (currentStep === 1) {
      if (!employeeId) nextErrors.employeeId = 'Selecione um colaborador';
      if (!stockObraId) nextErrors.stockObraId = 'Selecione o estoque de saída';
    }
    if (currentStep === 2) {
      if (items.length === 0) nextErrors.items = 'Adicione pelo menos um equipamento';
      if (items.some(item => {
        const quantity = Number(item.quantity);
        return !item.description.trim() || !item.materialId || !item.stockId || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999;
      })) {
        nextErrors.items = 'Selecione EPIs existentes no estoque e informe quantidades inteiras entre 1 e 9999';
      }
      const totals = new Map<string, number>();
      items.forEach(item => {
        if (item.stockId) totals.set(item.stockId, (totals.get(item.stockId) || 0) + Number(item.quantity || 0));
      });
      const insufficientStockId = [...totals.entries()].find(([stockId, quantity]) => quantity > (stocks.find(stock => stock.id === stockId)?.quantity ?? 0))?.[0];
      if (insufficientStockId) nextErrors.items = `Saldo insuficiente para ${stocks.find(stock => stock.id === insufficientStockId)?.materialDescription || 'o EPI selecionado'}`;
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
        <div className="flex flex-wrap justify-center gap-4">
          <button 
            type="button"
            onClick={handleDownloadPdf}
            disabled={isGeneratingPdf}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isGeneratingPdf ? 'Gerando PDF...' : generatedPdfBlob ? 'Baixar Ficha PDF' : 'Gerar e baixar PDF'}
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
        {setupError && <div role="alert" className="p-4 bg-red-50 text-red-800">{setupError} <button type="button" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></div>}
        {errors.save && <p role="alert" className="p-4 bg-red-50 text-red-800">{errors.save}</p>}
        <div className="delivery-form-body">
          {currentStep === 1 && <section className="delivery-section">
            <div className="delivery-section-heading"><div><span>ETAPA 1</span><h3>Funcionário, obra e data</h3><p>Defina o contexto antes de selecionar os equipamentos.</p></div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="delivery-date">Horário atual (gravado ao confirmar)</label>
                <input 
                  id="delivery-date" type="datetime-local"
                  value={date}
                  disabled
                  className="w-full px-3 py-2.5 sm:py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-500 text-sm min-h-[44px]"
                />
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="delivery-employee" className="block text-sm font-medium text-slate-700">
                    Nome do Empregado
                  </label>
                  {activeObra && (
                    <span className="text-xs text-[#2bb2c8] font-medium">
                      Filtrando: {activeObra.name}
                    </span>
                  )}
                </div>
                <select id="delivery-employee" disabled={setupLoading}
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
                {!setupLoading && !setupError && filteredEmployees.length === 0 && (
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
                <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="delivery-stock">Estoque de saída *</label>
                <select id="delivery-stock" value={stockObraId} onChange={event => { setStockObraId(event.target.value); setStocks([]); setItems([{ ca: '', description: '', quantity: '' }]); setErrors(current => ({ ...current, stockObraId: '' })); }} className={cn('field-control', errors.stockObraId && 'border-red-500')}>
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
            {stockWarning && <div role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{stockWarning} <button type="button" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></div>}
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
                    <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor={`item-ca-${index}`}>CA do equipamento</label>
                    <input 
                      type="text" 
                      value={item.ca}
                      id={`item-ca-${index}`} readOnly
                      placeholder="Ex: 36982"
                      className="w-full px-3 py-2.5 sm:py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8] text-sm min-h-[44px]"
                    />
                  </div>

                  <div className="sm:col-span-6">
                    <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor={`item-material-${index}`}>Equipamento de Proteção *</label>
                    <select id={`item-material-${index}`} value={item.stockId || ''}
                      disabled={stockLoading}
                      onChange={(e) => handleMaterialSelect(index, e.target.value)}
                      className="field-control">
                      <option value="">{stockLoading ? 'Carregando estoque...' : 'Selecione um EPI do estoque'}</option>
                      {stocks.map(stock => <option key={stock.id} value={stock.id}>
                        {stock.materialDescription} · CA: {stock.ca || 'sem CA'} · {stock.quantity} {stock.unit} · Código: {stock.materialId}
                      </option>)}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor={`item-quantity-${index}`}>Quant.</label>
                    <input 
                      id={`item-quantity-${index}`} type="number"
                      min="1"
                      max="9999"
                      step="1"
                      inputMode="numeric"
                      value={item.quantity || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        handleItemChange(index, 'quantity', val === '' ? '' : Number(val));
                      }}
                      className="w-full px-3 py-2.5 sm:py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8] text-sm min-h-[44px]"
                    />
                  </div>
                </div>
              ))}
              {errors.items && <p className="text-sm text-red-500 font-medium">{errors.items}</p>}
            </div>
          </section>}

          <section hidden={currentStep !== 3} className="delivery-section">
            <div className="delivery-section-heading"><div><span>ETAPA 3</span><h3>Revisão, assinatura e confirmação</h3><p>Revise os dados da entrega antes de registrar a ficha.</p></div></div>
            <div className="delivery-review">
              <div><span>Funcionário</span><strong>{employees.find(item => item.id === employeeId)?.name || 'Não selecionado'}</strong></div>
              <div><span>Obra do atendimento</span><strong>{activeObra.name}</strong></div>
              <div><span>Estoque de saída</span><strong>{userObras.find(item => item.id === stockObraId)?.name || 'Não selecionado'}</strong></div>
              <div><span>Itens selecionados</span><strong>{items.length} item(ns)</strong></div>
            </div>
            <div className="delivery-review-items overflow-x-auto">
              <table><caption className="text-left font-semibold">EPIs a receber</caption>
                <thead><tr><th>Equipamento</th><th>CA</th><th>Quantidade</th></tr></thead>
                <tbody>{items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.ca || 'Sem CA'}</td><td>{item.quantity} {stocks.find(stock => stock.id === item.stockId)?.unit || 'UN'}</td></tr>)}</tbody>
              </table>
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
          </section>

        </div>

        <div className="delivery-actions">
          {currentStep > 1 && <button type="button" onClick={() => setCurrentStep(step => step - 1)} className="secondary-action"><ArrowLeft className="w-4 h-4" />Voltar</button>}
          {currentStep < 3 ? <button type="button" disabled={setupLoading || stockLoading || !!setupError} onClick={continueStep} className="primary-action">Continuar <ArrowRight className="w-4 h-4" /></button> : <button type="submit" disabled={isSubmitting} className="primary-action">
            {isSubmitting ? <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Salvando Ficha...</> : <><Save className="w-5 h-5" />Salvar Ficha de EPI</>}
          </button>}
        </div>
      </form>
    </div>
  );
}
