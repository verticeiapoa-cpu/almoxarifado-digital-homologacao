import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, getDocs, doc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { AlertTriangle, BellRing, CircleCheck, CircleOff, Edit2, Plus, Shield } from 'lucide-react';
import { db } from '../lib/firebase';
import { cn } from '../components/Layout';
import { useAuth } from '../lib/AuthContext';
import { queueLowStockAlert } from '../lib/stockAlerts';
import { loadMaterialStock, parseStockCount, saveMaterialStock } from '../lib/inventory';
import type { InventoryStock, Material } from '../types';
import { logError, logWarning } from '../lib/logger';

const BASIC_EPI_CATALOG = [
  'Capacete de segurança',
  'Óculos de proteção',
  'Protetor facial',
  'Protetor auricular tipo plug',
  'Protetor auricular tipo concha',
  'Respirador semifacial',
  'Máscara descartável',
  'Luva de proteção',
  'Luva anticorte',
  'Bota de segurança',
  'Botina de segurança',
  'Colete refletivo',
  'Capa de chuva',
  'Perneira de proteção',
  'Avental de proteção',
  'Cinturão para trabalho em altura',
  'Talabarte de segurança',
  'Trava-quedas',
] as const;

const catalogMaterialId = (description: string) => `catalog-${description.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export default function Materials() {
  const { profile, user, isAdmin, activeObraId, userObras } = useAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [alertWarning, setAlertWarning] = useState('');
  const fetchSequence = useRef(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImportingCatalog, setIsImportingCatalog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [stockLoadError, setStockLoadError] = useState('');
  const [expectedQuantity, setExpectedQuantity] = useState<number | null>(null);
  const newMaterialId = useRef<string | null>(null);
  const saving = useRef(false);
  const [formData, setFormData] = useState({ description: '', ca: '', stockObraId: activeObraId === 'ALL' ? '' : activeObraId, quantity: '0', minimumStock: '0', unit: 'UN' });

  const fetchData = async () => {
    if (!profile) return;
    const sequence = ++fetchSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const [materialSnapshot, stockSnapshot] = await Promise.all([
        isAdmin ? getDocs(query(collection(db, 'materials'), where('companyId', '==', profile.companyId))) : Promise.resolve(null),
        activeObraId === 'ALL' ? Promise.resolve(null) : getDocs(query(collection(db, 'inventoryStock'), where('companyId', '==', profile.companyId), where('obraId', '==', activeObraId))),
      ]);
      if (sequence !== fetchSequence.current) return;
      const loadedStocks = stockSnapshot?.docs.map(item => ({ id: item.id, ...item.data() } as InventoryStock)) ?? [];
      setMaterials(materialSnapshot
        ? materialSnapshot.docs.map(item => ({ id: item.id, ...item.data() } as Material))
        : loadedStocks.map(stock => ({ id: stock.materialId, description: stock.materialDescription, ca: stock.ca, companyId: stock.companyId, isActive: true })));
      setStocks(loadedStocks);
    } catch (error) {
      logError('materials-load-failed', error);
      if (sequence === fetchSequence.current) setLoadError('Não foi possível carregar o estoque desta obra. Tente novamente para conferir os saldos.');
    } finally {
      if (sequence === fetchSequence.current) setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [profile?.companyId, activeObraId, isAdmin]);

  useEffect(() => {
    if (!isFormOpen || !editingId || !formData.stockObraId || !profile) return;
    let cancelled = false;
    setStockLoading(true);
    setStockLoadError('');
    loadMaterialStock(db, profile.companyId, formData.stockObraId, editingId)
      .then(stock => {
        if (cancelled) return;
        setExpectedQuantity(stock?.quantity ?? null);
        setFormData(current => ({ ...current, quantity: String(stock?.quantity ?? 0), minimumStock: String(stock?.minimumStock ?? 0), unit: stock?.unit || 'UN' }));
      })
      .catch(error => {
        if (cancelled) return;
      logError('inventory-load-failed', error);
        setStockLoadError('Não foi possível consultar o saldo desta obra. Feche e reabra a edição para tentar novamente.');
      })
      .finally(() => { if (!cancelled) setStockLoading(false); });
    return () => { cancelled = true; };
  }, [isFormOpen, editingId, formData.stockObraId, profile?.companyId]);

  const stockByMaterial = useMemo(() => new Map(stocks.map(stock => [stock.materialId, stock])), [stocks]);
  const visibleMaterials = isAdmin ? materials : materials.filter(material => stockByMaterial.has(material.id));
  const lowStockCount = stocks.filter(stock => stock.minimumStock > 0 && stock.quantity <= stock.minimumStock).length;

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setFormData(current => ({ ...current, [name]: ['quantity', 'minimumStock', 'stockObraId'].includes(name) ? value : value.toUpperCase() }));
  };

  const resetForm = () => {
    setFormData({ description: '', ca: '', stockObraId: activeObraId === 'ALL' ? '' : activeObraId, quantity: '0', minimumStock: '0', unit: 'UN' });
    setEditingId(null);
    setIsFormOpen(false);
    setFormError('');
    setStockLoadError('');
    setStockLoading(false);
    setExpectedQuantity(null);
    newMaterialId.current = null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !user || !isAdmin || saving.current || stockLoading || stockLoadError) return;
    setFormError('');
    setSavedMessage('');
    setAlertWarning('');
    const obra = userObras.find(item => item.id === formData.stockObraId);
    if (!obra) {
      setFormError('Selecione a obra que receberá este saldo.');
      return;
    }
    setIsSubmitting(true);
    saving.current = true;
    try {
      const quantity = parseStockCount(formData.quantity, 'Saldo atual');
      const minimumStock = parseStockCount(formData.minimumStock, 'Estoque mínimo');
      const description = formData.description.trim();
      if (!description || description.length > 200 || formData.ca.trim().length > 50) {
        throw new Error('Preencha a descrição (até 200 caracteres) e confira o C.A. (até 50 caracteres).');
      }
      if (!editingId && !newMaterialId.current) newMaterialId.current = doc(collection(db, 'materials')).id;
      const materialId = editingId || newMaterialId.current!;
      const currentMaterial = editingId ? materials.find(item => item.id === editingId) : undefined;
      const material: Material = { id: materialId, description, ca: formData.ca.trim(), companyId: profile.companyId, isActive: currentMaterial?.isActive ?? true };
      const stock = await saveMaterialStock(db, {
        material, isNewMaterial: !editingId, obra, companyId: profile.companyId,
        userId: user.uid, quantity, minimumStock, unit: formData.unit,
        expectedQuantity: editingId ? expectedQuantity : null,
      });
      setSavedMessage(`Saldo confirmado: ${stock.quantity} ${stock.unit} de ${stock.materialDescription} em ${stock.obraName}.`);
      resetForm();
      await fetchData();
      try {
        const queued = await queueLowStockAlert(profile.companyId, stock, user.uid);
        if (queued) {
          const alertAt = new Date().toISOString();
          await updateDoc(doc(db, 'inventoryStock', stock.id), { lowStockAlertSent: true, lastLowStockAlertAt: alertAt, updatedAt: alertAt });
        }
      } catch (alertError) {
      logWarning('material-low-stock-alert-failed', alertError);
        if (stock.minimumStock > 0 && stock.quantity <= stock.minimumStock) {
          setAlertWarning('O saldo foi salvo, mas o aviso por e-mail não foi enviado. Confira a configuração dos alertas.');
        }
      }
    } catch (error) {
      logError('material-save-failed', error);
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code).replace('firestore/', '') : '';
      setFormError(code === 'permission-denied'
        ? 'O Firebase recusou a operação de estoque desta obra. Nenhuma alteração desta tentativa foi salva. Verifique as permissões com o administrador.'
        : code ? 'Não foi possível confirmar o salvamento. Seus dados continuam no formulário; confira a conexão e tente novamente.'
        : error instanceof Error ? error.message : 'Não foi possível salvar o saldo desta obra. Tente novamente.');
    } finally {
      setIsSubmitting(false);
      saving.current = false;
    }
  };

  const openNewForm = () => {
    resetForm();
    setSavedMessage('');
    setEditingId(null);
    setFormData({ description: '', ca: '', stockObraId: activeObraId === 'ALL' ? '' : activeObraId, quantity: '0', minimumStock: '0', unit: 'UN' });
    setIsFormOpen(true);
  };

  const handleEdit = (material: Material) => {
    if (saving.current) return;
    const stock = stockByMaterial.get(material.id);
    setEditingId(material.id);
    setFormError('');
    setSavedMessage('');
    setStockLoadError('');
    setExpectedQuantity(stock?.quantity ?? null);
    setFormData({ description: material.description, ca: material.ca, stockObraId: activeObraId === 'ALL' ? '' : activeObraId, quantity: String(stock?.quantity ?? 0), minimumStock: String(stock?.minimumStock ?? 0), unit: stock?.unit || 'UN' });
    setIsFormOpen(true);
  };

  const handleToggleActive = async (material: Material) => {
    if (!isAdmin || !window.confirm(`${material.isActive ? 'Inativar' : 'Reativar'} este EPI? Os saldos e o histórico serão preservados.`)) return;
    await updateDoc(doc(db, 'materials', material.id), { isActive: !material.isActive, updatedAt: new Date().toISOString() });
    await fetchData();
  };

  const handleImportBasicCatalog = async () => {
    if (!profile || !user || !isAdmin || isImportingCatalog) return;
    const confirmed = window.confirm(`Importar ${BASIC_EPI_CATALOG.length} EPIs básicos para o catálogo e criar saldo inicial zero nas obras? Os itens já existentes serão preservados.`);
    if (!confirmed) return;
    setIsImportingCatalog(true);
    setSavedMessage('');
    setFormError('');
    try {
      const now = new Date().toISOString();
      const [allStocksSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'inventoryStock'), where('companyId', '==', profile.companyId))),
      ]);
      const existingDescriptions = new Set(materials.map(material => material.description.trim().toLocaleLowerCase('pt-BR')));
      const existingStockIds = new Set(allStocksSnapshot.docs.map(item => item.id));
      const batch = writeBatch(db);
      let importedMaterials = 0;
      let createdStocks = 0;

      for (const description of BASIC_EPI_CATALOG) {
        const materialId = catalogMaterialId(description);
        const materialExists = existingDescriptions.has(description.toLocaleLowerCase('pt-BR'));
        if (!materialExists) {
          batch.set(doc(db, 'materials', materialId), {
            id: materialId,
            description,
            ca: '',
            companyId: profile.companyId,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          });
          importedMaterials += 1;
        }
        for (const obra of userObras) {
          const stockId = `${obra.id}__${materialId}`;
          if (existingStockIds.has(stockId)) continue;
          batch.set(doc(db, 'inventoryStock', stockId), {
            id: stockId,
            companyId: profile.companyId,
            obraId: obra.id,
            obraName: obra.name,
            materialId,
            materialDescription: description,
            ca: '',
            quantity: 0,
            minimumStock: 0,
            unit: 'UN',
            lowStockAlertSent: false,
            createdAt: now,
            updatedAt: now,
          });
          createdStocks += 1;
        }
      }
      if (importedMaterials === 0 && createdStocks === 0) {
        setSavedMessage('O catálogo básico já está importado. Nenhum item novo foi criado.');
      } else {
        await batch.commit();
        setSavedMessage(`${importedMaterials} EPIs importados e ${createdStocks} saldos iniciais criados. Os CAs permanecem pendentes de validação.`);
        await fetchData();
      }
    } catch (error) {
      logError('basic-catalog-import-failed', error);
      setFormError('Não foi possível importar o catálogo básico. Nenhuma alteração parcial foi confirmada.');
    } finally {
      setIsImportingCatalog(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end gap-3"><div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Estoque por obra</h2><p className="text-sm text-slate-500 mt-1">Cada canteiro mantém saldo e limite mínimo independentes.</p></div>{isAdmin && !isFormOpen && <div className="flex flex-wrap justify-end gap-2"><button disabled={isSubmitting || isImportingCatalog} onClick={handleImportBasicCatalog} className="secondary-action">{isImportingCatalog ? 'Importando...' : 'Importar catálogo básico'}</button><button disabled={isSubmitting || isImportingCatalog} onClick={openNewForm} className="primary-action"><Plus />Novo EPI</button></div>}</div>
      {savedMessage && <div role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{savedMessage}</div>}
      {alertWarning && <div role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{alertWarning}</div>}
      {loadError && <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{loadError}<button type="button" onClick={fetchData} className="secondary-action mt-3">Tentar novamente</button></div>}
      {activeObraId === 'ALL' && <div className="work-required-card"><Shield /><div><strong>Selecione uma obra no topo</strong><span>O estoque só é exibido dentro do canteiro escolhido.</span></div></div>}
      {activeObraId !== 'ALL' && !loadError && lowStockCount > 0 && <div className="low-stock-banner"><AlertTriangle /><div><strong>{lowStockCount} {lowStockCount === 1 ? 'item atingiu' : 'itens atingiram'} o estoque mínimo</strong><span>Confira a reposição e a configuração dos alertas.</span></div></div>}

      {isAdmin && isFormOpen && <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">{editingId ? 'Editar EPI e saldo' : 'Cadastrar EPI no estoque'}</h3>
        {(formError || stockLoadError) && <div role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">{formError || stockLoadError}</div>}
        {stockLoading && <p role="status" className="mb-4 text-sm text-slate-600">Consultando o saldo da obra selecionada…</p>}
        <fieldset disabled={isSubmitting} className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="md:col-span-2"><label className="field-label">Descrição *</label><input required maxLength={200} name="description" value={formData.description} onChange={handleInputChange} className="field-control" /></div>
          <div><label className="field-label">C.A.</label><input maxLength={50} name="ca" value={formData.ca} onChange={handleInputChange} className="field-control" /></div>
          <div><label className="field-label">Saldo atual *</label><input required min="0" max="999999" step="1" disabled={stockLoading} type="number" inputMode="numeric" name="quantity" value={formData.quantity} onChange={handleInputChange} className="field-control" /></div>
          <div><label className="field-label">Estoque mínimo *</label><input required min="0" max="999999" step="1" disabled={stockLoading} type="number" inputMode="numeric" name="minimumStock" value={formData.minimumStock} onChange={handleInputChange} className="field-control" /></div>
          <div><label className="field-label">Unidade</label><select disabled={stockLoading} name="unit" value={formData.unit} onChange={handleInputChange} className="field-control"><option>UN</option><option>PAR</option><option>CX</option><option>PCT</option></select></div>
          <div className="md:col-span-3"><label className="field-label">Estoque da obra *</label><select required name="stockObraId" value={formData.stockObraId} onChange={handleInputChange} className="field-control"><option value="">Selecione...</option>{userObras.map(obra => <option key={obra.id} value={obra.id}>{obra.name}</option>)}</select></div>
        </fieldset>
        <div className="flex justify-end gap-3 mt-5"><button type="button" disabled={isSubmitting} onClick={resetForm} className="secondary-action">Cancelar</button><button type="submit" disabled={isSubmitting || stockLoading || Boolean(stockLoadError)} className="primary-action">{isSubmitting ? 'Salvando...' : 'Salvar'}</button></div>
      </form>}

      {activeObraId !== 'ALL' && !loadError && (loading ? <div className="flex justify-center py-12"><div className="spinner" /></div> : visibleMaterials.length === 0 ? <div className="empty-card"><Shield /><strong>Nenhum EPI neste estoque</strong><span>O administrador pode cadastrar o primeiro saldo desta obra.</span></div> : <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-500 border-b border-slate-200"><tr><th className="px-5 py-4">Equipamento</th><th className="px-5 py-4">C.A.</th><th className="px-5 py-4">Saldo</th><th className="px-5 py-4">Mínimo</th><th className="px-5 py-4">Situação</th><th className="px-5 py-4 text-right">Ações</th></tr></thead><tbody className="divide-y divide-slate-200">{visibleMaterials.map(material => {
        const stock = stockByMaterial.get(material.id);
        const isLow = Boolean(stock && stock.minimumStock > 0 && stock.quantity <= stock.minimumStock);
        return <tr key={material.id} className={cn(isLow && 'bg-amber-50/70')}><td className="px-5 py-4 font-medium text-slate-900">{material.description}</td><td className="px-5 py-4 font-mono text-slate-600">{material.ca || '-'}</td><td className="px-5 py-4 font-bold">{stock ? `${stock.quantity} ${stock.unit}` : 'Não cadastrado'}</td><td className="px-5 py-4 text-slate-600">{stock ? `${stock.minimumStock} ${stock.unit}` : '-'}</td><td className="px-5 py-4"><span className={cn('stock-status', !stock ? 'stock-status-empty' : isLow ? 'stock-status-low' : 'stock-status-ok')}>{isLow && <BellRing />}{!stock ? 'SEM SALDO' : isLow ? 'ESTOQUE BAIXO' : 'NORMAL'}</span></td><td className="px-5 py-4 text-right">{isAdmin ? <><button onClick={() => handleEdit(material)} className="icon-action"><Edit2 /></button><button onClick={() => handleToggleActive(material)} className="icon-action">{material.isActive ? <CircleOff /> : <CircleCheck />}</button></> : <span className="text-xs text-slate-400">Somente leitura</span>}</td></tr>;
      })}</tbody></table></div></div>)}
    </div>
  );
}
