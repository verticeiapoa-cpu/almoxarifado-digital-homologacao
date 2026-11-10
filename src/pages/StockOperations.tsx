import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeftRight, ClipboardList, PackagePlus, RotateCcw, RefreshCw } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { receiveStock } from '../lib/stage2Operations';
import { transferStock } from '../lib/stockTransfer';
import { registerStockReturn } from '../lib/stockReturns';
import type { InventoryStock, Material, Obra } from '../types';
import { logError } from '../lib/logger';

type Operation = 'receipt' | 'transfer' | 'return';
const field = 'field-control';
const label = 'field-label';

export default function StockOperationsPage() {
  const { profile, user, isAdmin, obras } = useAuth();
  const [operation, setOperation] = useState<Operation>('receipt');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [obraId, setObraId] = useState('');
  const [sourceObraId, setSourceObraId] = useState('');
  const [destinationObraId, setDestinationObraId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('UN');
  const [minimumStock, setMinimumStock] = useState('0');
  const [reference, setReference] = useState('');
  const [supplier, setSupplier] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [condition, setCondition] = useState<'GOOD' | 'DAMAGED' | 'UNSAFE'>('GOOD');
  const [destination, setDestination] = useState<'AVAILABLE' | 'QUARANTINE' | 'DISCARDED'>('AVAILABLE');
  const [reason, setReason] = useState('');

  const activeObras = useMemo(() => obras.filter(obra => obra.isActive), [obras]);
  const selectedMaterial = materials.find(item => item.id === materialId);
  const selectedStock = stocks.find(item => item.obraId === obraId && item.materialId === materialId);
  const sourceStock = stocks.find(item => item.obraId === sourceObraId && item.materialId === materialId);

  const loadData = async () => {
    if (!profile?.companyId) return;
    setLoading(true); setError('');
    try {
      const [materialSnapshot, stockSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'materials'), where('companyId', '==', profile.companyId))),
        getDocs(query(collection(db, 'inventoryStock'), where('companyId', '==', profile.companyId))),
      ]);
      setMaterials(materialSnapshot.docs.map(item => ({ id: item.id, ...item.data() } as Material)).filter(item => item.isActive));
      setStocks(stockSnapshot.docs.map(item => ({ id: item.id, ...item.data() } as InventoryStock)));
    } catch (e) {
      logError('stage2-stock-operations-load-failed', e);
      setError('Não foi possível carregar materiais e saldos. Verifique a conexão e tente novamente.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadData(); }, [profile?.companyId]);
  useEffect(() => {
    if (!obraId && activeObras.length) setObraId(activeObras[0].id);
    if (!sourceObraId && activeObras.length) setSourceObraId(activeObras[0].id);
    if (!destinationObraId && activeObras.length > 1) setDestinationObraId(activeObras[1].id);
  }, [activeObras, obraId, sourceObraId, destinationObraId]);

  useEffect(() => {
    if (selectedMaterial) {
      setUnit(selectedStock?.unit || sourceStock?.unit || selectedMaterial.unit || 'UN');
      setMinimumStock(String(selectedStock?.minimumStock ?? sourceStock?.minimumStock ?? selectedMaterial.minimumStock ?? 0));
    }
  }, [materialId, selectedStock?.id, sourceStock?.id]);

  const resetFeedback = () => { setError(''); setMessage(''); };
  const validateCommon = () => {
    if (!profile || !user) throw new Error('Sessão não identificada. Entre novamente.');
    if (!selectedMaterial) throw new Error('Selecione um material ativo.');
    const amount = Number(quantity);
    if (!/^\d{1,6}$/.test(quantity) || !Number.isSafeInteger(amount) || amount < 1 || amount > 999999) throw new Error('Informe uma quantidade inteira entre 1 e 999999.');
    return amount;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); resetFeedback();
    if (!isAdmin || !profile || !user) { setError('Acesso restrito ao administrador nesta versão.'); return; }
    setSaving(true);
    try {
      const amount = validateCommon();
      const obra = (id: string): Obra => {
        const found = activeObras.find(item => item.id === id);
        if (!found) throw new Error('Selecione uma obra ativa.');
        return found;
      };
      if (operation === 'receipt') {
        const target = obra(obraId);
        if (reference.trim().length < 1) throw new Error('Informe a nota fiscal ou referência do recebimento.');
        await receiveStock(db, {
          companyId: profile.companyId, obraId: target.id, obraName: target.name,
          materialId: selectedMaterial.id, materialDescription: selectedMaterial.description,
          ca: selectedMaterial.ca || '', quantity: amount, unit, minimumStock: Number(minimumStock),
          reference, supplier, lotNumber, expiresAt, userId: user.uid,
        });
        setMessage('Recebimento registrado. O saldo e o histórico foram atualizados.');
        setReference(''); setSupplier(''); setLotNumber(''); setExpiresAt('');
      } else if (operation === 'transfer') {
        const source = obra(sourceObraId); const target = obra(destinationObraId);
        if (source.id === target.id) throw new Error('A obra de origem e a de destino devem ser diferentes.');
        await transferStock(db, {
          companyId: profile.companyId, sourceObraId: source.id, sourceObraName: source.name,
          destinationObraId: target.id, destinationObraName: target.name,
          materialId: selectedMaterial.id, materialDescription: selectedMaterial.description,
          ca: selectedMaterial.ca || '', quantity: amount, unit, minimumStock: Number(minimumStock),
          reason, userId: user.uid,
        });
        setMessage('Transferência concluída. Os dois saldos e o histórico foram atualizados.');
        setReason('');
      } else {
        const target = obra(obraId);
        if (!selectedStock) throw new Error('Não existe saldo cadastrado desse material na obra selecionada.');
        await registerStockReturn(db, {
          companyId: profile.companyId, obraId: target.id, obraName: target.name,
          materialId: selectedMaterial.id, materialDescription: selectedMaterial.description,
          ca: selectedMaterial.ca || '', quantity: amount, unit, minimumStock: Number(minimumStock),
          condition, destination, reason, userId: user.uid,
        });
        setMessage(destination === 'AVAILABLE'
          ? 'Devolução registrada e saldo disponível atualizado.'
          : 'Devolução registrada. O saldo disponível não foi alterado.');
        setReason('');
      }
      await loadData();
    } catch (e) {
      logError('stage2-stock-operation-save-failed', e);
      setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.');
    } finally { setSaving(false); }
  };

  if (!isAdmin) return <div className="empty-card"><ClipboardList /><strong>Acesso restrito</strong><span>Recebimentos, transferências e devoluções são operações administrativas nesta versão.</span></div>;

  return <div className="flex flex-col gap-5">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Movimentações de estoque</h2><p className="mt-1 text-sm text-slate-500">Registre entradas, transferências e devoluções com histórico auditável.</p></div>
      <button type="button" onClick={() => void loadData()} disabled={loading || saving} className="secondary-action"><RefreshCw />Atualizar</button>
    </div>
    <div className="grid grid-cols-3 gap-2">
      <button type="button" onClick={() => { setOperation('receipt'); resetFeedback(); }} className={operation === 'receipt' ? 'primary-action justify-center' : 'secondary-action justify-center'}><PackagePlus />Receber</button>
      <button type="button" onClick={() => { setOperation('transfer'); resetFeedback(); }} className={operation === 'transfer' ? 'primary-action justify-center' : 'secondary-action justify-center'}><ArrowLeftRight />Transferir</button>
      <button type="button" onClick={() => { setOperation('return'); resetFeedback(); }} className={operation === 'return' ? 'primary-action justify-center' : 'secondary-action justify-center'}><RotateCcw />Devolver</button>
    </div>
    {message && <div role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {loading ? <div className="py-10 text-center">Carregando materiais e saldos…</div> : materials.length === 0 ? <div className="empty-card"><ClipboardList /><strong>Nenhum material ativo</strong><span>Cadastre ou ative um material no catálogo antes de movimentar o estoque.</span></div> :
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h3 className="mb-4 text-lg font-semibold text-slate-900">{operation === 'receipt' ? 'Recebimento de material' : operation === 'transfer' ? 'Transferência entre obras' : 'Devolução ao almoxarifado'}</h3>
      <fieldset disabled={saving} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={label}>Material *
          <select required value={materialId} onChange={e => setMaterialId(e.target.value)} className={field}><option value="">Selecione o material</option>{materials.map(item => <option key={item.id} value={item.id}>{item.description}{item.ca ? ' · C.A. '+item.ca : ''}</option>)}</select>
        </label>
        {operation === 'transfer' ? <>
          <label className={label}>Obra de origem *<select required value={sourceObraId} onChange={e => setSourceObraId(e.target.value)} className={field}><option value="">Selecione</option>{activeObras.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className={label}>Obra de destino *<select required value={destinationObraId} onChange={e => setDestinationObraId(e.target.value)} className={field}><option value="">Selecione</option>{activeObras.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 sm:col-span-2">Saldo na origem: <strong>{sourceStock ? sourceStock.quantity+' '+sourceStock.unit : 'Sem saldo cadastrado'}</strong></div>
        </> : <>
          <label className={label}>Obra *<select required value={obraId} onChange={e => setObraId(e.target.value)} className={field}><option value="">Selecione</option>{activeObras.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {operation === 'return' && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Saldo disponível atual: <strong>{selectedStock ? selectedStock.quantity+' '+selectedStock.unit : 'Sem saldo cadastrado'}</strong></div>}
        </>}
        <label className={label}>Quantidade *<input required type="number" min="1" max="999999" step="1" inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} className={field} /></label>
        <label className={label}>Unidade<select value={unit} onChange={e => setUnit(e.target.value)} className={field}><option>UN</option><option>PAR</option><option>CX</option><option>PCT</option><option>KG</option><option>M</option><option>L</option></select></label>
        {operation === 'receipt' && <>
          <label className={label}>Nota fiscal / referência *<input required maxLength={80} value={reference} onChange={e => setReference(e.target.value)} className={field} placeholder="Ex.: NF 12345" /></label>
          <label className={label}>Fornecedor<input maxLength={120} value={supplier} onChange={e => setSupplier(e.target.value)} className={field} /></label>
          <label className={label}>Lote (opcional)<input maxLength={80} value={lotNumber} onChange={e => setLotNumber(e.target.value)} className={field} /></label>
          <label className={label}>Validade (opcional)<input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className={field} /></label>
        </>}
        {operation === 'return' && <>
          <label className={label}>Condição do item<select value={condition} onChange={e => { setCondition(e.target.value as typeof condition); if (e.target.value !== 'GOOD') setDestination('QUARANTINE'); }} className={field}><option value="GOOD">Bom estado</option><option value="DAMAGED">Danificado</option><option value="UNSAFE">Impróprio para uso</option></select></label>
          <label className={label}>Destino<select value={destination} onChange={e => setDestination(e.target.value as typeof destination)} className={field}><option value="AVAILABLE">Estoque disponível</option><option value="QUARANTINE">Quarentena</option><option value="DISCARDED">Descarte</option></select></label>
        </>}
        {operation !== 'receipt' && <label className={label+' sm:col-span-2'}>Motivo / observação *<textarea required minLength={5} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className={field} rows={3} placeholder="Descreva o motivo da operação" /></label>}
      </fieldset>
      <div className="mt-5 flex justify-end"><button type="submit" disabled={saving || loading || !materialId || activeObras.length === 0} className="primary-action">{saving ? 'Registrando…' : operation === 'receipt' ? 'Confirmar recebimento' : operation === 'transfer' ? 'Confirmar transferência' : 'Registrar devolução'}</button></div>
    </form>}
  </div>;
}
