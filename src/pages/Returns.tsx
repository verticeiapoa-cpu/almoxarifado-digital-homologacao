import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logError } from '../lib/logger';
import { inspectReturn, newOperationId, registerReturn } from '../lib/operationsService';
import { RETURN_CONDITION_LABEL } from '../lib/operations';
import { formatDateTime } from '../lib/movements';
import type { Delivery, Employee, ReturnCondition, ReturnRecord } from '../types';
import { ConfirmPanel, Feedback, NoAccess, ObraField, PageHeader, Step, today, useGuardedAction, useOperationContext } from '../components/OperationUi';

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
  const [reviewing, setReviewing] = useState(false);
  const [formError, setFormError] = useState('');
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
    setReviewing(false);
    if (ok) { operationId.current = newOperationId(db, 'returns'); setQuantity(''); setNotes(''); setReload(n => n + 1); }
  };
  const inspect = (r: ReturnRecord, resolution: 'BOM_ESTADO' | 'DANIFICADO' | 'INSERVIVEL') =>
    guard.run(() => inspectReturn(db, r, resolution, resolveNotes[r.id]?.trim() || undefined, ctx.actor!), 'Inspeção registrada.').then(ok => ok && setReload(n => n + 1));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Funcionário devolveu EPI" text="Registre a devolução ligada à entrega original. Só item em bom estado volta ao estoque." />
      <Step n={1} title="Quem devolveu?">
        <ObraField ctx={ctx} label="Obra" />
        <div><label className="field-label" htmlFor="rt-emp">Funcionário</label>
          <select id="rt-emp" className="field-control" value={employeeId} onChange={e => { setEmployeeId(e.target.value); setReviewing(false); }}><option value="">Toque para escolher</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
      </Step>
      <Step n={2} title="O que foi devolvido?">
        <div><label className="field-label" htmlFor="rt-del">Item entregue a ele</label>
          <select id="rt-del" className="field-control" value={pick} onChange={e => { setPick(e.target.value); setReviewing(false); }} disabled={!employeeId}><option value="">{employeeId && options.length === 0 ? 'Nenhuma entrega encontrada para este funcionário' : 'Toque para escolher'}</option>
            {options.map(o => <option key={o.key} value={o.key}>{o.item.description} — entregue em {formatDateTime(o.delivery.timestamp)} ({String(o.item.quantity)} un.)</option>)}</select></div>
        <div><label className="field-label" htmlFor="rt-qty">Quantos voltaram?</label><input id="rt-qty" inputMode="numeric" autoComplete="off" className="field-control" value={quantity} onChange={e => { setQuantity(e.target.value); setReviewing(false); }} placeholder="Ex.: 1" /></div>
        <div><label className="field-label" htmlFor="rt-date">Data da devolução</label><input id="rt-date" type="date" className="field-control" value={returnedAt} max={today()} onChange={e => setReturnedAt(e.target.value)} /></div>
      </Step>
      <Step n={3} title="Em que estado o item voltou?">
        <select id="rt-cond" aria-label="Condição do item" className="field-control" value={condition} onChange={e => { setCondition(e.target.value as ReturnCondition); setReviewing(false); }}>{(Object.keys(RETURN_CONDITION_LABEL) as ReturnCondition[]).map(c => <option key={c} value={c}>{RETURN_CONDITION_LABEL[c]}</option>)}</select>
        <p className="op-hint">{condition === 'BOM_ESTADO' ? 'O item volta a contar no estoque disponível.' : condition === 'PENDENTE_INSPECAO' ? 'Fica separado até alguém conferir. Depois você decide se está bom ou não.' : 'O item NÃO volta ao estoque, mas o registro fica guardado.'}</p>
        <div><label className="field-label" htmlFor="rt-obs">Observação{condition === 'INSERVIVEL' ? ' (obrigatória: explique o motivo)' : ' (opcional)'}</label><input id="rt-obs" className="field-control" maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </Step>
      {formError && <div role="alert" className="notice notice-error">{formError}</div>}
      <Feedback error={guard.error || loadError} success={guard.success} />
      {reviewing && chosen && employee ? (
        <ConfirmPanel title="Confira a devolução" busy={guard.busy} confirmLabel="Confirmar devolução" onBack={() => setReviewing(false)} onConfirm={submit}
          lines={[`Funcionário: ${employee.name}`, `Item: ${chosen.item.description}`, `Quantidade: ${quantity}`, `Estado: ${RETURN_CONDITION_LABEL[condition]}`, condition === 'BOM_ESTADO' ? 'O item volta ao estoque.' : 'O item não volta ao estoque disponível.']} />
      ) : (
        <button type="button" className="primary-action" style={{ minHeight: 52, fontSize: '1rem' }} disabled={!chosen || !quantity.trim()} onClick={() => { setFormError(''); const n = Number(quantity.trim()); if (!/^\d+$/.test(quantity.trim()) || n < 1) { setFormError('Informe quantos itens voltaram (número inteiro, a partir de 1).'); return; } if (condition === 'INSERVIVEL' && notes.trim().length < 5) { setFormError('Para item inservível, explique o motivo na observação.'); return; } setReviewing(true); }}><Undo2 />Revisar devolução</button>
      )}

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
