import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, FileSpreadsheet, Info } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { logError } from '../lib/logger';
import { fetchMovements, fetchUserNames, type MovementResult } from '../lib/reportData';
import { buildDataScope } from '../lib/reports';
import {
  MOVEMENT_TYPE_LABEL, OPERATION_LABEL, OPERATION_ROUTE, filterMovements, formatBalance, formatDateTime, formatSignedQuantity,
  periodBounds, responsibleLabel, type MovementType, type MovementView,
} from '../lib/movements';
import { MovementTypeBadge } from '../components/StockUi';

const PAGE_SIZE = 50;
const MAX_ROWS = 500;

const toDateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysAgo = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); return toDateInput(date); };

export default function Movements() {
  const { profile, user, obras, activeObraId } = useAuth();
  const scope = useMemo(() => (profile ? buildDataScope(profile, obras) : null), [profile, obras]);
  const obraName = useMemo(() => new Map(obras.map(obra => [obra.id, obra.name] as const)), [obras]);

  const [selection, setSelection] = useState(() => (activeObraId && activeObraId !== 'ALL' ? activeObraId : 'ALL'));
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(toDateInput(new Date()));
  const [type, setType] = useState<MovementType | ''>('');
  const [materialId, setMaterialId] = useState('');
  const [result, setResult] = useState<MovementResult | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sequence = useRef(0);

  // Acompanha o seletor global de obra, mas só aceita obras dentro do escopo do usuário.
  useEffect(() => {
    if (!scope) return;
    setSelection(activeObraId !== 'ALL' && scope.obraIds.includes(activeObraId) ? activeObraId : 'ALL');
  }, [activeObraId, scope]);

  const bounds = useMemo(() => periodBounds(from, to), [from, to]);

  useEffect(() => {
    if (!scope) return;
    const current = ++sequence.current;
    if (!scope.isAdmin && scope.obraIds.length === 0) { setLoading(false); setResult({ rows: [], truncated: false, unordered: false }); return; }
    setLoading(true);
    setError('');
    setVisible(PAGE_SIZE);
    Promise.all([
      fetchMovements(db, scope, selection, { ...bounds, max: MAX_ROWS }),
      fetchUserNames(db, scope),
    ]).then(([movements, userNames]) => {
      if (current !== sequence.current) return;
      setResult(movements);
      setNames(userNames);
      setMaterialId('');
    }).catch(loadError => {
      if (current !== sequence.current) return;
      logError('movements-load-failed', loadError);
      setResult(null);
      setError('Não foi possível carregar as movimentações. Verifique a conexão e tente novamente.');
    }).finally(() => { if (current === sequence.current) setLoading(false); });
  }, [scope, selection, bounds]);

  const rows = result?.rows ?? [];
  const materialOptions = useMemo(() => {
    const options = new Map<string, string>();
    rows.forEach(row => { if (row.materialId) options.set(row.materialId, row.materialDescription || row.materialId); });
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [rows]);
  const filtered = useMemo(() => filterMovements(rows, { materialId, type }), [rows, materialId, type]);
  const shown = filtered.slice(0, visible);

  if (!profile || !scope) return null;
  const obraLabel = (row: MovementView) => row.obraName ?? obraName.get(row.obraId) ?? row.obraId;
  const who = (row: MovementView) => responsibleLabel(row.createdBy, names, user?.uid) || '—';
  const qtyClass = (quantity: number | null) => (quantity === null ? '' : quantity > 0 ? 'qty-in' : quantity < 0 ? 'qty-out' : '');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-between items-end gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Movimentações</h2>
          <p className="text-sm text-slate-500 mt-1">Histórico de entradas, entregas e ajustes das obras que você pode acessar.</p>
        </div>
        <Link to="/reports" className="secondary-action"><FileSpreadsheet />Relatórios</Link>
      </div>

      <section className="filter-bar" aria-label="Filtros">
        <div><label className="field-label" htmlFor="mov-obra">Obra</label>
          <select id="mov-obra" className="field-control" value={selection} onChange={event => setSelection(event.target.value)}>
            {(scope.isAdmin || scope.obraIds.length > 1) && <option value="ALL">{scope.isAdmin ? 'Todas as obras' : 'Todas as minhas obras'}</option>}
            {obras.filter(obra => scope.obraIds.includes(obra.id)).map(obra => <option key={obra.id} value={obra.id}>{obra.name}{obra.isActive ? '' : ' (inativa)'}</option>)}
          </select></div>
        <div><label className="field-label" htmlFor="mov-type">Tipo</label>
          <select id="mov-type" className="field-control" value={type} onChange={event => setType(event.target.value as MovementType | '')}>
            <option value="">Todos os tipos</option>
            {(Object.keys(MOVEMENT_TYPE_LABEL) as MovementType[]).map(key => <option key={key} value={key}>{MOVEMENT_TYPE_LABEL[key]}</option>)}
          </select></div>
        <div><label className="field-label" htmlFor="mov-material">Item</label>
          <select id="mov-material" className="field-control" value={materialId} onChange={event => setMaterialId(event.target.value)} disabled={materialOptions.length === 0}>
            <option value="">Todos os itens</option>
            {materialOptions.map(([id, description]) => <option key={id} value={id}>{description}</option>)}
          </select></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="field-label" htmlFor="mov-from">De</label><input id="mov-from" type="date" className="field-control" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></div>
          <div><label className="field-label" htmlFor="mov-to">Até</label><input id="mov-to" type="date" className="field-control" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></div>
        </div>
      </section>

      {error && <div role="alert" className="notice notice-error">{error}</div>}
      {result?.unordered && <div role="status" className="notice notice-warn"><Info className="inline w-4 h-4 mr-1" />O índice de consulta das movimentações ainda não foi criado no Firebase. A lista abaixo pode estar incompleta; peça ao administrador técnico para publicar o índice de <code>firestore.indexes.json</code>.</div>}
      {result?.truncated && <div role="status" className="notice notice-warn">Exibindo as {MAX_ROWS} movimentações mais recentes por consulta. Reduza o período para ver registros anteriores.</div>}

      {loading ? <div className="flex justify-center py-12"><div className="spinner" /></div>
        : !error && filtered.length === 0 ? <div className="empty-card"><ArrowLeftRight /><strong>Nenhuma movimentação encontrada</strong><span>Ajuste os filtros ou o período.</span></div>
        : !error && <>
          <p className="text-xs text-slate-500" role="status">{filtered.length} {filtered.length === 1 ? 'movimentação' : 'movimentações'}</p>

          <div className="panel-card sm:hidden">
            {shown.map(row => (
              <article key={row.id} className="mov-card">
                <div className="flex items-center justify-between gap-2"><MovementTypeBadge type={row.type} label={row.typeLabel} /><small className="text-slate-500">{formatDateTime(row.createdAt) || 'Sem data'}</small></div>
                <strong className="text-sm text-slate-900">{row.materialDescription || 'Item não identificado'}</strong>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className={qtyClass(row.quantity)}>{formatSignedQuantity(row.quantity) || '—'}</span>
                  <span className="text-slate-600">Saldo: {formatBalance(row) || '—'}</span>
                </div>
                {row.operationType && <small><Link to={OPERATION_ROUTE[row.operationType]} className="text-cyan-700 underline">Origem: {OPERATION_LABEL[row.operationType]}</Link></small>}
                <small className="text-slate-500">{obraLabel(row)} · {who(row)}{row.deliveryId ? ` · Entrega ${row.deliveryId.slice(-6)}` : ''}</small>
                {row.note && <small className="text-slate-600">Obs.: {row.note}</small>}
              </article>
            ))}
          </div>

          <div className="panel-card hidden sm:block"><div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200"><tr>
                <th className="px-4 py-3">Data/hora</th><th className="px-4 py-3">Obra</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3 text-right">Qtd.</th><th className="px-4 py-3">Saldo</th><th className="px-4 py-3">Responsável</th><th className="px-4 py-3">Observação</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-200">
                {shown.map(row => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.createdAt) || '—'}</td>
                    <td className="px-4 py-3">{obraLabel(row)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.materialDescription || '—'}</td>
                    <td className="px-4 py-3"><MovementTypeBadge type={row.type} label={row.typeLabel} /></td>
                    <td className={`px-4 py-3 text-right ${qtyClass(row.quantity)}`}>{formatSignedQuantity(row.quantity) || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatBalance(row) || '—'}</td>
                    <td className="px-4 py-3">{who(row)}</td>
                    <td className="px-4 py-3 text-slate-600">{row.operationType ? <Link to={OPERATION_ROUTE[row.operationType]} className="text-cyan-700 underline">{OPERATION_LABEL[row.operationType]}</Link> : null}{row.operationType && row.note ? ' · ' : ''}{row.note || (!row.operationType && row.deliveryId ? `Entrega ${row.deliveryId.slice(-6)}` : (row.operationType ? '' : '—'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>

          {filtered.length > visible && <button type="button" className="secondary-action self-center" onClick={() => setVisible(count => count + PAGE_SIZE)}>Mostrar mais ({filtered.length - visible} restantes)</button>}
        </>}
    </div>
  );
}
