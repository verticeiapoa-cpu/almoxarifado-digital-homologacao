import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logError } from '../lib/logger';
import { adjustCountItem, closeCount, newOperationId, openCount, recordCountItem } from '../lib/operationsService';
import { parseQuantity } from '../lib/operations';
import type { InventoryCount, InventoryCountItem } from '../types';
import { Feedback, NoAccess, ObraField, PageHeader, today, useGuardedAction, useOperationContext, useStocks } from '../components/OperationUi';

const ITEM_LABEL = { SEM_DIVERGENCIA: 'Sem divergência', PENDENTE_AJUSTE: 'Divergência pendente', AJUSTADO: 'Ajustado' } as const;
const COUNT_LABEL = { EM_CONTAGEM: 'Em contagem', CONFIRMADA: 'Confirmada', CANCELADA: 'Cancelada' } as const;

export default function InventoryCountPage() {
  const ctx = useOperationContext();
  const [reload, setReload] = useState(0);
  const { stocks } = useStocks(ctx.scope, ctx.obraId, reload);
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [items, setItems] = useState<InventoryCountItem[]>([]);
  const [countId, setCountId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [just, setJust] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState('');
  const newId = useRef(newOperationId(db, 'inventoryCounts'));
  const guard = useGuardedAction();
  const companyId = ctx.profile?.companyId;

  const load = useCallback(async () => {
    if (!companyId || !ctx.obraId) return;
    try {
      const snap = await getDocsFromServer(query(collection(db, 'inventoryCounts'), where('companyId', '==', companyId), where('obraId', '==', ctx.obraId)));
      setCounts(snap.docs.map(d => ({ ...(d.data() as InventoryCount), id: d.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setLoadError('');
    } catch (e) { logError('counts-load-failed', e); setLoadError('Não foi possível carregar os inventários.'); }
  }, [companyId, ctx.obraId]);
  useEffect(() => { void load(); }, [load, reload]);
  useEffect(() => { setCountId(id => (counts.some(c => c.id === id) ? id : counts.find(c => c.status === 'EM_CONTAGEM')?.id ?? counts[0]?.id ?? '')); }, [counts]);
  useEffect(() => {
    if (!companyId || !ctx.obraId || !countId) { setItems([]); return; }
    getDocsFromServer(query(collection(db, 'inventoryCountItems'), where('companyId', '==', companyId), where('obraId', '==', ctx.obraId), where('countId', '==', countId)))
      .then(s => setItems(s.docs.map(d => ({ ...(d.data() as InventoryCountItem), id: d.id }))))
      .catch(e => { logError('count-items-load-failed', e); setLoadError('Não foi possível carregar os itens da contagem.'); });
  }, [companyId, ctx.obraId, countId, reload]);

  const count = counts.find(c => c.id === countId);
  const byMaterial = useMemo(() => new Map(items.map(i => [i.materialId, i])), [items]);
  const pending = items.filter(i => i.status === 'PENDENTE_AJUSTE').length;
  if (!ctx.profile || !ctx.actor) return null;
  if (ctx.accessibleObras.length === 0) return <NoAccess />;
  const open = count?.status === 'EM_CONTAGEM';
  const done = (ok: boolean) => ok && setReload(n => n + 1);

  const start = async () => {
    if (!ctx.obra) return;
    const id = newId.current;
    const ok = await guard.run(() => openCount(db, id, ctx.obra!.id, ctx.obra!.name, today(), ctx.actor!), 'Contagem aberta.');
    if (ok) { newId.current = newOperationId(db, 'inventoryCounts'); setCountId(id); done(true); }
  };
  const record = (materialId: string) => count && guard.run(() => recordCountItem(db, count, materialId, parseQuantity(qty[materialId] ?? '', 'Quantidade contada', true), just[materialId], ctx.actor!), 'Contagem registrada. O saldo só muda quando o ajuste for confirmado.').then(done);
  const adjust = (item: InventoryCountItem) => guard.run(() => adjustCountItem(db, item, ctx.canAdjust, ctx.obra?.name ?? '', ctx.actor!), 'Ajuste aplicado e movimentação registrada.').then(done);
  const close = (status: 'CONFIRMADA' | 'CANCELADA') => count && guard.run(() => closeCount(db, count, status, pending, ctx.canAdjust, cancelReason, ctx.actor!), status === 'CONFIRMADA' ? 'Inventário confirmado.' : 'Inventário cancelado.').then(done);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Contar o estoque" text="Conte o que tem na prateleira e digite. Se for diferente do sistema, explique o motivo. Contar sozinho não muda o estoque — só o ajuste muda." />
      {!ctx.canAdjust && <div className="notice notice-warn">Você pode contar e registrar. Para corrigir o estoque é preciso que o administrador libere a permissão “Pode ajustar estoque” no seu cadastro.</div>}
      <section className="filter-bar" aria-label="Contagem">
        <ObraField ctx={ctx} />
        <div><label className="field-label" htmlFor="ic-sel">Contagem</label>
          <select id="ic-sel" className="field-control" value={countId} onChange={e => setCountId(e.target.value)}>{counts.length === 0 && <option value="">Nenhuma</option>}{counts.map(c => <option key={c.id} value={c.id}>{c.countedAt} · {COUNT_LABEL[c.status]} · {c.countedByName}</option>)}</select></div>
        <div className="flex items-end"><button type="button" className="primary-action w-full" disabled={guard.busy || counts.some(c => c.status === 'EM_CONTAGEM')} onClick={start}><ClipboardCheck />Começar uma contagem</button></div>
      </section>
      <Feedback error={guard.error || loadError} success={guard.success} />

      {count && <section className="panel-card" aria-label="Itens da contagem">{stocks.map(s => {
        const item = byMaterial.get(s.materialId);
        return (
          <article key={s.materialId} className="mov-card">
            <div className="flex justify-between gap-2"><strong className="text-sm">{s.materialDescription}</strong><span className="text-xs text-slate-500">{item ? ITEM_LABEL[item.status] : 'Não contado'}</span></div>
            {item ? <small className="text-slate-600">Sistema {item.systemQty} · contado {item.countedQty} · diferença {item.difference > 0 ? '+' : ''}{item.difference}{item.justification ? ` · ${item.justification}` : ''}{item.status === 'AJUSTADO' ? ` · saldo final ${item.balanceAfter}` : ''}</small>
              : open && <div className="flex flex-wrap gap-2 items-center">
                <small className="text-slate-500">O sistema diz: {s.quantity} {s.unit}</small>
                <input aria-label={`Quantidade contada de ${s.materialDescription}`} inputMode="numeric" className="field-control" style={{ maxWidth: 110 }} placeholder="Quanto tem?" value={qty[s.materialId] ?? ''} onChange={e => setQty(q => ({ ...q, [s.materialId]: e.target.value }))} />
                <input aria-label={`Justificativa de ${s.materialDescription}`} className="field-control" style={{ maxWidth: 260 }} placeholder="Justificativa (se houver diferença)" maxLength={300} value={just[s.materialId] ?? ''} onChange={e => setJust(j => ({ ...j, [s.materialId]: e.target.value }))} />
                <button type="button" className="secondary-action" disabled={guard.busy || !(qty[s.materialId] ?? '').trim()} onClick={() => record(s.materialId)}>Registrar</button></div>}
            {item?.status === 'PENDENTE_AJUSTE' && open && ctx.canAdjust && <button type="button" className="primary-action self-start" disabled={guard.busy} onClick={() => adjust(item)}>Corrigir o estoque para o valor contado</button>}
          </article>);
      })}</section>}

      {open && <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="primary-action" disabled={guard.busy || pending > 0 || !ctx.canAdjust} onClick={() => close('CONFIRMADA')}>Confirmar inventário{pending > 0 ? ` (${pending} pendente${pending > 1 ? 's' : ''})` : ''}</button>
        <input aria-label="Motivo do cancelamento" placeholder="Motivo para cancelar" className="field-control" style={{ maxWidth: 240 }} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
        <button type="button" className="secondary-action" disabled={guard.busy} onClick={() => close('CANCELADA')}>Cancelar contagem</button></div>}
    </div>
  );
}
