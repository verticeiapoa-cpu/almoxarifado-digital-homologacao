import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, X } from 'lucide-react';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logError } from '../lib/logger';
import { cancelTransfer, confirmTransfer, newOperationId, requestTransfer } from '../lib/operationsService';
import { parseQuantity } from '../lib/operations';
import { formatDateTime } from '../lib/movements';
import type { Transfer } from '../types';
import { ConfirmPanel, Feedback, ItemPicker, NoAccess, PageHeader, Step, useGuardedAction, useOperationContext, useStocks } from '../components/OperationUi';

const STATUS_LABEL = { PENDENTE: 'Pendente', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' } as const;

export default function Transfers() {
  const ctx = useOperationContext();
  const [reload, setReload] = useState(0);
  const [toObraId, setToObraId] = useState('');
  const { stocks, loading } = useStocks(ctx.scope, ctx.obraId, reload);
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [formError, setFormError] = useState('');
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [listError, setListError] = useState('');
  const [cancelReason, setCancelReason] = useState<Record<string, string>>({});
  const operationId = useRef(newOperationId(db, 'transfers'));
  const guard = useGuardedAction();
  const obraIds = useMemo(() => ctx.accessibleObras.map(o => o.id), [ctx.accessibleObras]);

  const load = useCallback(async () => {
    if (!ctx.profile || obraIds.length === 0) return;
    try {
      const results = await Promise.all(obraIds.flatMap(id => ['fromObraId', 'toObraId'].map(field =>
        getDocsFromServer(query(collection(db, 'transfers'), where('companyId', '==', ctx.profile!.companyId), where(field, '==', id))))));
      const map = new Map<string, Transfer>();
      results.forEach(r => r.docs.forEach(d => map.set(d.id, { ...(d.data() as Transfer), id: d.id })));
      setTransfers([...map.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)));
      setListError('');
    } catch (e) { logError('transfers-load-failed', e); setListError('Não foi possível carregar as transferências.'); }
  }, [ctx.profile, obraIds]);
  useEffect(() => { void load(); }, [load, reload]);

  const destinations = ctx.accessibleObras.filter(o => o.id !== ctx.obraId);
  const stock = stocks.find(s => s.materialId === materialId);
  if (!ctx.profile || !ctx.actor) return null;
  if (ctx.accessibleObras.length < 2 && !ctx.isAdmin) return <NoAccess>Para transferir é preciso ter acesso a pelo menos duas obras.</NoAccess>;

  const submit = async () => {
    const to = ctx.accessibleObras.find(o => o.id === toObraId); const from = ctx.obra;
    if (!from || !to || !stock) return;
    const ok = await guard.run(() => requestTransfer(db, {
      operationId: operationId.current, fromObraId: from.id, fromObraName: from.name, toObraId: to.id, toObraName: to.name,
      materialId: stock.materialId, materialDescription: stock.materialDescription, unit: stock.unit, quantity: parseQuantity(quantity), notes: notes.trim() || undefined,
    }, obraIds, Boolean(ctx.isAdmin), ctx.actor!), 'Pedido registrado. O estoque só muda quando alguém confirmar o recebimento abaixo, em “Pedidos de transferência”.');
    setReviewing(false);
    if (ok) { operationId.current = newOperationId(db, 'transfers'); setQuantity(''); setNotes(''); setReload(n => n + 1); }
  };
  const confirm = (t: Transfer) => guard.run(() => confirmTransfer(db, t.id, t.fromObraId, t.toObraId, t.materialId, obraIds, Boolean(ctx.isAdmin), ctx.actor!), 'Transferência concluída: origem baixada e destino creditado.').then(ok => ok && setReload(n => n + 1));
  const cancel = (t: Transfer) => guard.run(() => cancelTransfer(db, t.id, cancelReason[t.id] ?? '', obraIds, Boolean(ctx.isAdmin), ctx.actor!), 'Transferência cancelada.').then(ok => ok && setReload(n => n + 1));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Mandar material para outra obra" text="Faça o pedido e depois confirme. Ao confirmar, o estoque sai de uma obra e entra na outra ao mesmo tempo." />
      <Step n={1} title="De onde sai e para onde vai?">
        <div><label className="field-label" htmlFor="tr-from">Sai da obra</label>
          <select id="tr-from" className="field-control" value={ctx.obraId} onChange={e => { ctx.setObraId(e.target.value); setMaterialId(''); setReviewing(false); }}>{ctx.accessibleObras.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div><label className="field-label" htmlFor="tr-to">Vai para a obra</label>
          <select id="tr-to" className="field-control" value={toObraId} onChange={e => { setToObraId(e.target.value); setReviewing(false); }}><option value="">Toque para escolher</option>{destinations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <p className="op-hint">Só aparecem as obras que você pode acessar. Precisa ter acesso às duas.</p>
      </Step>
      <Step n={2} title="O que e quanto?">
        <ItemPicker id="tr-mat" label="Item" stocks={stocks} value={materialId} onChange={id => { setMaterialId(id); setReviewing(false); }} />
        <div><label className="field-label" htmlFor="tr-qty">Quantidade{stock ? ` (${stock.unit})` : ''}</label><input id="tr-qty" inputMode="numeric" autoComplete="off" className="field-control" value={quantity} onChange={e => { setQuantity(e.target.value); setReviewing(false); }} placeholder="Ex.: 10" /></div>
        {stock && <p className="op-hint">Na obra de saída tem hoje: <strong>{stock.quantity} {stock.unit}</strong></p>}
        <div><label className="field-label" htmlFor="tr-obs">Observação (opcional)</label><input id="tr-obs" className="field-control" maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </Step>
      {formError && <div role="alert" className="notice notice-error">{formError}</div>}
      <Feedback error={guard.error} success={guard.success} />
      {reviewing && stock ? (
        <ConfirmPanel title="Confira o pedido" busy={guard.busy} confirmLabel="Fazer o pedido" onBack={() => setReviewing(false)} onConfirm={submit}
          lines={[`Item: ${stock.materialDescription}`, `Quantidade: ${quantity} ${stock.unit}`, `De: ${ctx.obra?.name ?? ''}`, `Para: ${ctx.accessibleObras.find(o => o.id === toObraId)?.name ?? ''}`, 'O estoque só muda quando o pedido for confirmado.']} />
      ) : (
        <button type="button" className="primary-action" style={{ minHeight: 52, fontSize: '1rem' }} disabled={!stock || !toObraId || !quantity.trim()} onClick={() => { setFormError(''); try { parseQuantity(quantity); setReviewing(true); } catch (e) { setFormError((e as Error).message); } }}><ArrowLeftRight />Revisar pedido</button>
      )}

      <h3 className="text-lg font-semibold text-slate-900">Pedidos de transferência</h3>
      {listError && <div role="alert" className="notice notice-error">{listError}</div>}
      {transfers.length === 0 ? <div className="empty-card"><ArrowLeftRight /><strong>Nenhuma transferência</strong></div> : (
        <div className="panel-card">{transfers.map(t => (
          <article key={t.id} className="mov-card">
            <div className="flex justify-between gap-2"><strong className="text-sm">{t.materialDescription} · {t.quantity} {t.unit}</strong><span className="text-xs text-slate-500">{STATUS_LABEL[t.status]}</span></div>
            <small className="text-slate-500">{t.fromObraName} → {t.toObraName} · {formatDateTime(t.requestedAt)} · {t.requestedByName}{t.correctsTransferId ? ' · correção' : ''}</small>
            {t.notes && <small className="text-slate-600">Obs.: {t.notes}</small>}
            {t.status === 'CANCELADA' && <small className="text-slate-600">Cancelada: {t.cancelReason}</small>}
            {t.status === 'PENDENTE' && obraIds.includes(t.fromObraId) && obraIds.includes(t.toObraId) && (
              <div className="flex flex-wrap gap-2 items-center">
                <button type="button" className="primary-action" disabled={guard.busy} onClick={() => confirm(t)}><Check />Confirmar que foi feito</button>
                <input aria-label="Motivo do cancelamento" placeholder="Motivo para cancelar" className="field-control" style={{ maxWidth: 240 }} value={cancelReason[t.id] ?? ''} onChange={e => setCancelReason(r => ({ ...r, [t.id]: e.target.value }))} />
                <button type="button" className="secondary-action" disabled={guard.busy} onClick={() => cancel(t)}><X />Cancelar</button>
              </div>)}
          </article>))}</div>)}
    </div>
  );
}
