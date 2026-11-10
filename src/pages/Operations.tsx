import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeftRight, ClipboardList, PackageCheck, PackagePlus, RefreshCw, ShieldAlert } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import type { InventoryStock } from '../types';
import { confirmInventoryCount, recordReceipt, recordReturn, transferStock, type ReturnCondition } from '../lib/operations';
import { logError } from '../lib/logger';

type Tab = 'receipt' | 'transfer' | 'return' | 'count';
const fieldClass = 'field-control';
const labelClass = 'field-label';

export default function Operations() {
  const { profile, user, isAdmin, activeObraId, userObras } = useAuth();
  const canAdjust = isAdmin || profile?.permissions?.canAdjustStock === true;
  const obraKey = userObras.map(obra => obra.id).join('|');
  const [tab, setTab] = useState<Tab>('receipt');
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState({ stockId: '', quantity: '1', supplier: '', invoiceNumber: '', lotCode: '', expiresAt: '', notes: '' });
  const [transfer, setTransfer] = useState({ sourceId: '', destinationId: '', quantity: '1', notes: '' });
  const [returned, setReturned] = useState({ stockId: '', quantity: '1', condition: 'AVAILABLE' as ReturnCondition, employeeName: '', reference: '', notes: '' });
  const [count, setCount] = useState({ stockId: '', countedQuantity: '', reason: '' });

  const loadStocks = async () => {
    if (!profile) return;
    setLoading(true);
    setError('');
    try {
      const snapshots = await Promise.all(userObras.map(obra => getDocs(query(
        collection(db, 'inventoryStock'), where('companyId', '==', profile.companyId), where('obraId', '==', obra.id),
      ))));
      const rows = snapshots.flatMap(snapshot => snapshot.docs.map(item => ({ id: item.id, ...item.data() } as InventoryStock)));
      rows.sort((a, b) => a.obraName.localeCompare(b.obraName) || a.materialDescription.localeCompare(b.materialDescription));
      setStocks(rows);
      const preferred = rows.find(stock => stock.obraId === activeObraId)?.id || rows[0]?.id || '';
      setReceipt(current => ({ ...current, stockId: rows.some(stock => stock.id === current.stockId) ? current.stockId : preferred }));
      setTransfer(current => ({ ...current, sourceId: rows.some(stock => stock.id === current.sourceId) ? current.sourceId : preferred, destinationId: '' }));
      setReturned(current => ({ ...current, stockId: rows.some(stock => stock.id === current.stockId) ? current.stockId : preferred }));
      setCount(current => ({ ...current, stockId: rows.some(stock => stock.id === current.stockId) ? current.stockId : preferred }));
    } catch (loadError) {
      logError('operations-stock-load-failed', loadError);
      setError('Não foi possível carregar os saldos autorizados. Verifique a obra liberada para este usuário.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadStocks(); }, [profile?.companyId, obraKey]);

  const byId = useMemo(() => new Map(stocks.map(stock => [stock.id, stock])), [stocks]);
  const selectedReceipt = byId.get(receipt.stockId);
  const selectedSource = byId.get(transfer.sourceId);
  const destinations = selectedSource ? stocks.filter(stock =>
    stock.materialId === selectedSource.materialId && stock.unit === selectedSource.unit && stock.obraId !== selectedSource.obraId
  ) : [];
  const selectedReturn = byId.get(returned.stockId);
  const selectedCount = byId.get(count.stockId);
  const stocksInActiveObra = stocks.filter(stock => activeObraId === 'ALL' || stock.obraId === activeObraId);

  const run = async (action: () => Promise<string>, successMessage: string) => {
    if (!profile || !user || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const id = await action();
      setNotice(`${successMessage} Registro ${id.slice(0, 8)}.`);
      await loadStocks();
    } catch (saveError) {
      logError('operations-save-failed', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar esta operação.');
    } finally {
      setBusy(false);
    }
  };

  const submitReceipt = (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !user || !selectedReceipt) return;
    void run(() => recordReceipt(db, {
      stock: selectedReceipt, companyId: profile.companyId, userId: user.uid, quantity: Number(receipt.quantity),
      supplier: receipt.supplier, invoiceNumber: receipt.invoiceNumber, lotCode: receipt.lotCode,
      expiresAt: receipt.expiresAt, notes: receipt.notes,
    }), 'Recebimento registrado.');
  };
  const submitTransfer = (event: React.FormEvent) => {
    event.preventDefault();
    const destination = byId.get(transfer.destinationId);
    if (!profile || !user || !selectedSource || !destination) return;
    void run(() => transferStock(db, {
      source: selectedSource, destination, companyId: profile.companyId, userId: user.uid,
      quantity: Number(transfer.quantity), notes: transfer.notes,
    }), 'Transferência concluída nas duas obras.');
  };
  const submitReturn = (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !user || !selectedReturn) return;
    void run(() => recordReturn(db, {
      stock: selectedReturn, companyId: profile.companyId, userId: user.uid,
      quantity: Number(returned.quantity), condition: returned.condition,
      employeeName: returned.employeeName, reference: returned.reference, notes: returned.notes,
    }), returned.condition === 'AVAILABLE' ? 'Devolução reintegrada ao saldo.' : 'Devolução segregada; saldo disponível não foi alterado.');
  };
  const submitCount = (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !user || !selectedCount || !canAdjust) return;
    void run(() => confirmInventoryCount(db, {
      stock: selectedCount, companyId: profile.companyId, userId: user.uid,
      countedQuantity: Number(count.countedQuantity), expectedQuantity: selectedCount.quantity, reason: count.reason,
    }), 'Inventário físico confirmado.');
  };

  const tabs = [
    { id: 'receipt' as const, title: 'Recebimento', icon: PackagePlus },
    { id: 'transfer' as const, title: 'Transferência', icon: ArrowLeftRight },
    { id: 'return' as const, title: 'Devolução', icon: PackageCheck },
    ...(canAdjust ? [{ id: 'count' as const, title: 'Inventário', icon: ClipboardList }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Operações de estoque</h2><p className="text-sm text-slate-500 mt-1">Receber, transferir, devolver e conferir materiais por obra.</p></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tabs.map(item => {
          const Icon = item.icon;
          return <button key={item.id} type="button" onClick={() => { setTab(item.id); setError(''); setNotice(''); }}
            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold ${tab === item.id ? 'border-cyan-600 bg-cyan-50 text-cyan-900' : 'border-slate-200 bg-white text-slate-600'}`}>
            <Icon className="h-4 w-4" />{item.title}
          </button>;
        })}
      </div>
      {notice && <div role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
      {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" onClick={() => void loadStocks()} className="ml-3 underline">Atualizar</button></div>}
      {loading ? <div className="flex justify-center py-12"><div className="spinner" /></div> : stocks.length === 0 ? (
        <div className="empty-card"><ShieldAlert /><strong>Nenhum saldo cadastrado nas obras autorizadas</strong><span>Cadastre o EPI e o saldo inicial em Estoque antes de movimentar.</span></div>
      ) : <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        {tab === 'receipt' && <form onSubmit={submitReceipt} className="flex flex-col gap-4">
          <div><h3 className="text-lg font-semibold">Entrada / recebimento</h3><p className="text-sm text-slate-500">O saldo aumenta junto com o registro de entrada e a movimentação de auditoria. Lote e validade são apenas informativos nesta etapa.</p></div>
          <div><label className={labelClass}>Obra e material *</label><select required className={fieldClass} value={receipt.stockId} onChange={e => setReceipt({ ...receipt, stockId: e.target.value })}><option value="">Selecione...</option>{stocksInActiveObra.map(stock => <option key={stock.id} value={stock.id}>{stock.obraName} · {stock.materialDescription} · {stock.quantity} {stock.unit}</option>)}</select></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelClass}>Quantidade recebida *</label><input required type="number" min="1" max="999999" step="1" className={fieldClass} value={receipt.quantity} onChange={e => setReceipt({ ...receipt, quantity: e.target.value })} /></div>
            <div><label className={labelClass}>Fornecedor *</label><input required maxLength={160} className={fieldClass} value={receipt.supplier} onChange={e => setReceipt({ ...receipt, supplier: e.target.value })} /></div>
            <div><label className={labelClass}>Nota fiscal / documento</label><input maxLength={80} className={fieldClass} value={receipt.invoiceNumber} onChange={e => setReceipt({ ...receipt, invoiceNumber: e.target.value })} /></div>
            <div><label className={labelClass}>Lote (informativo)</label><input maxLength={80} className={fieldClass} value={receipt.lotCode} onChange={e => setReceipt({ ...receipt, lotCode: e.target.value })} /></div>
            <div><label className={labelClass}>Validade (informativa)</label><input type="date" className={fieldClass} value={receipt.expiresAt} onChange={e => setReceipt({ ...receipt, expiresAt: e.target.value })} /></div>
            <div><label className={labelClass}>Observações</label><input maxLength={300} className={fieldClass} value={receipt.notes} onChange={e => setReceipt({ ...receipt, notes: e.target.value })} /></div>
          </div>
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Saldo previsto: <strong>{selectedReceipt ? selectedReceipt.quantity + (Number(receipt.quantity) || 0) : '—'} {selectedReceipt?.unit || ''}</strong></p>
          <button className="primary-action self-end" disabled={busy || !selectedReceipt}>{busy ? 'Registrando...' : 'Confirmar recebimento'}</button>
        </form>}

        {tab === 'transfer' && <form onSubmit={submitTransfer} className="flex flex-col gap-4">
          <div><h3 className="text-lg font-semibold">Transferência entre obras</h3><p className="text-sm text-slate-500">A saída na origem e a entrada no destino são confirmadas na mesma transação; não há etapa de trânsito.</p></div>
          <div><label className={labelClass}>Origem *</label><select required className={fieldClass} value={transfer.sourceId} onChange={e => setTransfer({ ...transfer, sourceId: e.target.value, destinationId: '' })}><option value="">Selecione...</option>{stocks.map(stock => <option key={stock.id} value={stock.id}>{stock.obraName} · {stock.materialDescription} · {stock.quantity} {stock.unit}</option>)}</select></div>
          <div><label className={labelClass}>Destino *</label><select required className={fieldClass} value={transfer.destinationId} onChange={e => setTransfer({ ...transfer, destinationId: e.target.value })}><option value="">Selecione o mesmo item em outra obra...</option>{destinations.map(stock => <option key={stock.id} value={stock.id}>{stock.obraName} · saldo {stock.quantity} {stock.unit}</option>)}</select></div>
          <div><label className={labelClass}>Quantidade *</label><input required type="number" min="1" max={selectedSource?.quantity || 999999} step="1" className={fieldClass} value={transfer.quantity} onChange={e => setTransfer({ ...transfer, quantity: e.target.value })} /></div>
          <div><label className={labelClass}>Motivo da transferência *</label><textarea required rows={3} maxLength={300} className={fieldClass} value={transfer.notes} onChange={e => setTransfer({ ...transfer, notes: e.target.value })} /></div>
          <button className="primary-action self-end" disabled={busy || !selectedSource || !destinations.some(stock => stock.id === transfer.destinationId)}>{busy ? 'Transferindo...' : 'Confirmar transferência'}</button>
        </form>}

        {tab === 'return' && <form onSubmit={submitReturn} className="flex flex-col gap-4">
          <div><h3 className="text-lg font-semibold">Devolução de EPI / material</h3><p className="text-sm text-slate-500">Somente itens em condição de uso retornam ao saldo disponível. Avarias e descarte ficam segregados e auditáveis.</p></div>
          <div><label className={labelClass}>Obra e material *</label><select required className={fieldClass} value={returned.stockId} onChange={e => setReturned({ ...returned, stockId: e.target.value })}><option value="">Selecione...</option>{stocksInActiveObra.map(stock => <option key={stock.id} value={stock.id}>{stock.obraName} · {stock.materialDescription} · saldo {stock.quantity} {stock.unit}</option>)}</select></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelClass}>Quantidade devolvida *</label><input required type="number" min="1" max="999999" step="1" className={fieldClass} value={returned.quantity} onChange={e => setReturned({ ...returned, quantity: e.target.value })} /></div>
            <div><label className={labelClass}>Condição *</label><select className={fieldClass} value={returned.condition} onChange={e => setReturned({ ...returned, condition: e.target.value as ReturnCondition })}><option value="AVAILABLE">Em condições de uso — voltar ao estoque</option><option value="QUARANTINE">Avariado / suspeito — quarentena</option><option value="DISPOSAL">Descarte — pendente de baixa administrativa</option></select></div>
            <div><label className={labelClass}>Colaborador</label><input maxLength={120} className={fieldClass} value={returned.employeeName} onChange={e => setReturned({ ...returned, employeeName: e.target.value })} /></div>
            <div><label className={labelClass}>Referência (ficha / ocorrência)</label><input maxLength={120} className={fieldClass} value={returned.reference} onChange={e => setReturned({ ...returned, reference: e.target.value })} /></div>
          </div>
          <div><label className={labelClass}>Condição observada e motivo *</label><textarea required rows={3} maxLength={300} className={fieldClass} value={returned.notes} onChange={e => setReturned({ ...returned, notes: e.target.value })} /></div>
          <button className="primary-action self-end" disabled={busy || !selectedReturn}>{busy ? 'Registrando...' : 'Registrar devolução'}</button>
        </form>}

        {tab === 'count' && canAdjust && <form onSubmit={submitCount} className="flex flex-col gap-4">
          <div><h3 className="text-lg font-semibold">Inventário físico</h3><p className="text-sm text-slate-500">A contagem compara o saldo do sistema com o saldo encontrado. Cada item é confirmado individualmente.</p></div>
          <div><label className={labelClass}>Obra e material *</label><select required className={fieldClass} value={count.stockId} onChange={e => setCount({ ...count, stockId: e.target.value, countedQuantity: '' })}><option value="">Selecione...</option>{stocksInActiveObra.map(stock => <option key={stock.id} value={stock.id}>{stock.obraName} · {stock.materialDescription}</option>)}</select></div>
          {selectedCount && <p className="rounded-lg bg-slate-50 p-4 text-sm">Saldo atual no sistema: <strong className="text-lg">{selectedCount.quantity} {selectedCount.unit}</strong></p>}
          <div><label className={labelClass}>Quantidade contada fisicamente *</label><input required type="number" min="0" max="999999" step="1" className={fieldClass} value={count.countedQuantity} onChange={e => setCount({ ...count, countedQuantity: e.target.value })} /></div>
          {selectedCount && count.countedQuantity !== '' && <p className="text-sm text-slate-600">Diferença a registrar: <strong>{Number(count.countedQuantity) - selectedCount.quantity} {selectedCount.unit}</strong></p>}
          <div><label className={labelClass}>Justificativa do ajuste *</label><textarea required rows={3} maxLength={300} className={fieldClass} value={count.reason} onChange={e => setCount({ ...count, reason: e.target.value })} /></div>
          <p className="text-xs text-amber-700">Se houver movimentação durante a contagem, o sistema bloqueia a confirmação e exige nova conferência.</p>
          <button className="primary-action self-end" disabled={busy || !selectedCount || count.countedQuantity === ''}>{busy ? 'Confirmando...' : 'Confirmar contagem'}</button>
        </form>}
      </section>}
      <button type="button" onClick={() => void loadStocks()} disabled={loading || busy} className="secondary-action self-start"><RefreshCw className="h-4 w-4" />Atualizar saldos</button>
    </div>
  );
}
