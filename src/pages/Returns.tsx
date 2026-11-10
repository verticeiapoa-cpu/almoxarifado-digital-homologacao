import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logError } from '../lib/logger';
import { inspectReturn, newOperationId, registerReturn } from '../lib/operationsService';
import { RETURN_CONDITION_LABEL } from '../lib/operations';
import { formatDateTime } from '../lib/movements';
import type { Delivery, Employee, ReturnCondition, ReturnRecord } from '../types';
import { Feedback, NoAccess, ObraField, PageHeader, today, useGuardedAction, useOperationContext } from '../components/OperationUi';

export default function Returns() {
  const ctx = useOperationContext();
  const [reload, setReload] = useState(0);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [records, setRecords] = useState<ReturnRecord[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [pick, setPick] = useState(''); // "deliveryId:index"
  const [quantity, setQuantity] = useState('');
  const [condition, setCondition] = useState<ReturnCondition>('BOM_ESTADO');
  const [returnedAt, setReturnedAt] = useState(today());
  const [notes, setNotes] = useState('');
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const operationId = useRef(newOperationId(db, 'returns'));
  const guard = useGuardedAction();
  const companyId = ctx.profile?.companyId;

  const load = useCallback(async () => {
    if (!companyId || !ctx.obraId) return;
    try {
      const [emp, ret] = await Promise.all([
        getDocsFromServer(query(collection(db, 'employees'), where('companyId', '==', companyId), where('obraId', '==', ctx.obraId))),
        getDocsFromServer(query(collection(db, 'returns'), where('companyId', '==', companyId), where('obraId', '==', ctx.obraId))),
      ]);
      setEmployees(emp.docs.map(d => ({ ...(d.data() as Employee), id: d.id })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setRecords(ret.docs.map(d => ({ ...(d.data() as ReturnRecord), id: d.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setLoadError('');
    } catch (e) { logError('returns-load-failed', e); setLoadError('Não foi possível carregar os dados de devolução.'); }
  }, [companyId, ctx.obraId]);
  useEffect(() => { void load(); }, [load, reload]);

  useEffect(() => {
    setDeliveries([]); setPick('');
    if (!companyId || !ctx.obraId || !employeeId) return;
    getDocsFromServer(query(collection(db, 'deliveries'), where('companyId', '==', companyId), where('stockObraId', '==', ctx.obraId)))
      .then(s => setDeliveries(s.docs.map(d => ({ ...(d.data() as Delivery), id: d.id })).filter(d => d.employeeId === employeeId)))
      .catch(e => { logError('deliveries-load-failed', e); setLoadError('Não foi possível carregar as entregas do colaborador.'); });
  }, [companyId, ctx.obraId, employeeId]);

  const options = useMemo(() => deliveries.flatMap(d => d.items.map((item, index) => ({ key: `${d.id}:${index}`, delivery: d, index, item }))), [deliveries]);
  const chosen = options.find(o => o.key === pick);
  const employee = employees.find(e => e.id === employeeId);
  if (!ctx.profile || !ctx.actor) return null;
  if (ctx.accessibleObras.length === 0) return <NoAccess />;

  const submit = async () => {
    if (!chosen || !employee || !ctx.obra || !chosen.item.materialId) return;
    const ok = await guard.run(() => registerReturn(db, {
      operationId: operationId.current, obraId: ctx.obra!.id, obraName: ctx.obra!.name, employeeId: employee.id, employeeName: employee.name,
      materialId: chosen.item.materialId!, materialDescription: chosen.item.description, quantity: Number(quantity), condition, returnedAt, notes,
      deliveryId: chosen.delivery.id, deliveryItemIndex: chosen.index,
    }, ctx.actor!), condition === 'BOM_ESTADO' ? 'Devolução registrada e item devolvido ao estoque.' : 'Devolução registrada. O item NÃO volta ao estoque disponível.');
    if (ok) { operationId.current = newOperationId(db, 'returns'); setQuantity(''); setNotes(''); setReload(n => n + 1); }
  };
  const inspect = (r: ReturnRecord, resolution: 'BOM_ESTADO' | 'DANIFICADO' | 'INSERVIVEL') =>
    guard.run(() => inspectReturn(db, r, resolution, resolveNotes[r.id]?.trim() || undefined, ctx.actor!), 'Inspeção registrada.').then(ok => ok && setReload(n => n + 1));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Devolução" text="Registre a devolução de EPI vinculada a uma entrega. Apenas itens em bom estado voltam ao saldo disponível." />
      <section className="filter-bar" aria-label="Nova devolução">
        <ObraField ctx={ctx} />
        <div><label className="field-label" htmlFor="rt-emp">Colaborador</label>
          <select id="rt-emp" className="field-control" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Selecione</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div><label className="field-label" htmlFor="rt-del">Entrega / item</label>
          <select id="rt-del" className="field-control" value={pick} onChange={e => setPick(e.target.value)} disabled={!employeeId}><option value="">Selecione</option>
            {options.map(o => <option key={o.key} value={o.key}>{o.item.description} · {formatDateTime(o.delivery.timestamp)} · entregue {String(o.item.quantity)}</option>)}</select></div>
        <div><label className="field-label" htmlFor="rt-qty">Quantidade devolvida</label><input id="rt-qty" inputMode="numeric" className="field-control" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rt-cond">Condição</label>
          <select id="rt-cond" className="field-control" value={condition} onChange={e => setCondition(e.target.value as ReturnCondition)}>{(Object.keys(RETURN_CONDITION_LABEL) as ReturnCondition[]).map(c => <option key={c} value={c}>{RETURN_CONDITION_LABEL[c]}</option>)}</select></div>
        <div><label className="field-label" htmlFor="rt-date">Data</label><input id="rt-date" type="date" className="field-control" value={returnedAt} max={today()} onChange={e => setReturnedAt(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="rt-obs">Observação{condition === 'INSERVIVEL' ? ' (obrigatória)' : ' (opcional)'}</label><input id="rt-obs" className="field-control" maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </section>
      <Feedback error={guard.error || loadError} success={guard.success} />
      <button type="button" className="primary-action" disabled={guard.busy || !chosen || !quantity} onClick={submit}><Undo2 />{guard.busy ? 'Registrando…' : 'Registrar devolução'}</button>

      <h3 className="text-lg font-semibold text-slate-900">Devoluções da obra</h3>
      {records.length === 0 ? <div className="empty-card"><Undo2 /><strong>Nenhuma devolução registrada</strong></div> : (
        <div className="panel-card">{records.map(r => (
          <article key={r.id} className="mov-card">
            <div className="flex justify-between gap-2"><strong className="text-sm">{r.materialDescription} · {r.quantity}</strong><span className="text-xs text-slate-500">{r.status === 'INSPECIONADA' ? `Inspecionada: ${RETURN_CONDITION_LABEL[r.resolution ?? 'DANIFICADO']}` : RETURN_CONDITION_LABEL[r.condition]}</span></div>
            <small className="text-slate-500">{r.employeeName} · {r.returnedAt} · recebido por {r.receivedByName}{r.restocked ? ' · voltou ao estoque' : ' · fora do estoque disponível'}</small>
            {r.notes && <small className="text-slate-600">Obs.: {r.notes}</small>}
            {r.condition === 'PENDENTE_INSPECAO' && r.status === 'REGISTRADA' && (
              <div className="flex flex-wrap gap-2 items-center">
                <input aria-label="Observação da inspeção" placeholder="Observação (obrigatória p/ inservível)" className="field-control" style={{ maxWidth: 260 }} value={resolveNotes[r.id] ?? ''} onChange={e => setResolveNotes(n => ({ ...n, [r.id]: e.target.value }))} />
                <button type="button" className="secondary-action" disabled={guard.busy} onClick={() => inspect(r, 'BOM_ESTADO')}>Bom estado</button>
                <button type="button" className="secondary-action" disabled={guard.busy} onClick={() => inspect(r, 'DANIFICADO')}>Danificado</button>
                <button type="button" className="secondary-action" disabled={guard.busy} onClick={() => inspect(r, 'INSERVIVEL')}>Inservível</button>
              </div>)}
          </article>))}</div>)}
    </div>
  );
}
