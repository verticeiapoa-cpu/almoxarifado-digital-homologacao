import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { logError } from '../lib/logger';
import { buildCsv, csvFilename, downloadCsv } from '../lib/csv';
import { fetchMovements, fetchStocks, fetchUserNames } from '../lib/reportData';
import {
  STOCK_COLUMNS, buildDataScope, movementColumns, needsReplenishment, sortStockRows, type StockRow,
} from '../lib/reports';
import { STOCK_LEVEL_LABEL, stockLevel } from '../lib/stockStatus';
import { fetchCountItems, fetchReceipts, fetchReturns, fetchTransfers } from '../lib/operationData';
import { COUNT_ITEM_COLUMNS, RECEIPT_COLUMNS, RETURN_COLUMNS, TRANSFER_COLUMNS, filterCountItems, filterReceipts, filterReturns, filterTransfers } from '../lib/operationReports';
import type { InventoryCountItem, Receipt, ReturnRecord, Transfer } from '../types';
import { formatBalance, formatDateTime, formatSignedQuantity, periodBounds, type MovementView } from '../lib/movements';

type OperationKind = 'receipts' | 'transfers' | 'returns' | 'inventories' | 'adjustments';
type ReportKind = 'stock-position' | 'stock-replenishment' | 'movements' | OperationKind;
const isOperation = (kind: ReportKind): kind is OperationKind => ['receipts', 'transfers', 'returns', 'inventories', 'adjustments'].includes(kind);

const REPORTS: Array<{ kind: ReportKind; title: string; description: string }> = [
  { kind: 'stock-position', title: 'Posição de estoque', description: 'Saldo, mínimo, unidade e situação de cada item por obra.' },
  { kind: 'stock-replenishment', title: 'Itens para reposição', description: 'Somente itens sem saldo, críticos ou abaixo do mínimo.' },
  { kind: 'movements', title: 'Histórico de movimentações', description: 'Entradas, entregas e ajustes no período escolhido.' },
  { kind: 'receipts', title: 'Recebimentos', description: 'Entradas com fornecedor, NF, lote e validade.' },
  { kind: 'transfers', title: 'Transferências', description: 'Pendentes, concluídas e canceladas entre obras.' },
  { kind: 'returns', title: 'Devoluções', description: 'Condição do item, estoque, danificados e pendentes.' },
  { kind: 'inventories', title: 'Inventários', description: 'Contagens, divergências e justificativas.' },
  { kind: 'adjustments', title: 'Ajustes de estoque', description: 'Somente divergências efetivamente ajustadas.' },
];

const MAX_MOVEMENTS = 2000;
const PREVIEW_ROWS = 15;
const toDateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysAgo = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); return toDateInput(date); };

interface Generated {
  kind: ReportKind;
  selection: string;
  stocks?: StockRow[];
  movements?: MovementView[];
  receipts?: Receipt[]; transfers?: Transfer[]; returns?: ReturnRecord[]; counts?: InventoryCountItem[];
  names: Map<string, string>;
  truncated: boolean;
  unordered: boolean;
}

export default function Reports() {
  const { profile, user, obras, activeObraId } = useAuth();
  const scope = useMemo(() => (profile ? buildDataScope(profile, obras) : null), [profile, obras]);
  const obraName = useMemo(() => new Map(obras.map(obra => [obra.id, obra.name] as const)), [obras]);

  const [kind, setKind] = useState<ReportKind>('stock-position');
  const [selection, setSelection] = useState(() => (activeObraId && activeObraId !== 'ALL' ? activeObraId : 'ALL'));
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(toDateInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<Generated | null>(null);

  if (!profile || !scope) return null;
  const noAccess = !scope.isAdmin && scope.obraIds.length === 0;
  const reportTitle = REPORTS.find(report => report.kind === kind)!.title;

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setGenerated(null);
    try {
      if (isOperation(kind)) {
        const f = { fromDate: from, toDate: to };
        if (kind === 'receipts') { const r = await fetchReceipts(db, scope, selection); setGenerated({ kind, selection, receipts: filterReceipts(r.rows, scope, f), names: new Map(), truncated: r.truncated, unordered: false }); }
        else if (kind === 'transfers') { const r = await fetchTransfers(db, scope, selection); setGenerated({ kind, selection, transfers: filterTransfers(r.rows, scope, f), names: new Map(), truncated: r.truncated, unordered: false }); }
        else if (kind === 'returns') { const r = await fetchReturns(db, scope, selection); setGenerated({ kind, selection, returns: filterReturns(r.rows, scope, f), names: new Map(), truncated: r.truncated, unordered: false }); }
        else { const r = await fetchCountItems(db, scope, selection); setGenerated({ kind, selection, counts: filterCountItems(r.rows, scope, f, kind === 'adjustments'), names: new Map(), truncated: r.truncated, unordered: false }); }
      } else if (kind === 'movements') {
        const bounds = periodBounds(from, to);
        const [result, names] = await Promise.all([
          fetchMovements(db, scope, selection, { ...bounds, max: MAX_MOVEMENTS }),
          fetchUserNames(db, scope),
        ]);
        setGenerated({ kind, selection, movements: result.rows, names, truncated: result.truncated, unordered: result.unordered });
      } else {
        const stocks = sortStockRows(await fetchStocks(db, scope, selection));
        setGenerated({ kind, selection, stocks: kind === 'stock-replenishment' ? needsReplenishment(stocks) : stocks, names: new Map(), truncated: false, unordered: false });
      }
    } catch (loadError) {
      logError('report-generation-failed', loadError);
      setError('Não foi possível gerar o relatório. Verifique a conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!generated) return;
    const where = generated.selection === 'ALL' ? 'todas-as-obras' : obraName.get(generated.selection) || 'obra';
    const title = REPORTS.find(report => report.kind === generated.kind)!.title;
    const csv = generated.receipts ? buildCsv(RECEIPT_COLUMNS, generated.receipts)
      : generated.transfers ? buildCsv(TRANSFER_COLUMNS, generated.transfers)
      : generated.returns ? buildCsv(RETURN_COLUMNS, generated.returns)
      : generated.counts ? buildCsv(COUNT_ITEM_COLUMNS, generated.counts)
      : generated.movements
      ? buildCsv(movementColumns(generated.names, obraName, user?.uid), generated.movements)
      : buildCsv(STOCK_COLUMNS, generated.stocks ?? []);
    downloadCsv(csvFilename(`${title} ${where}`), csv);
  };

  const rowCount = generated ? (generated.movements ?? generated.stocks ?? generated.receipts ?? generated.transfers ?? generated.returns ?? generated.counts ?? []).length : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Relatórios</h2>
        <p className="text-sm text-slate-500 mt-1">Gere a prévia e baixe em CSV (abre no Excel). Os dados respeitam as obras do seu acesso.</p>
      </div>

      {noAccess && <div className="empty-card"><FileSpreadsheet /><strong>Sem obra vinculada</strong><span>Peça ao administrador para vincular uma obra ao seu perfil.</span></div>}

      {!noAccess && <>
        <section className="grid gap-2 sm:grid-cols-3" aria-label="Tipo de relatório">
          {REPORTS.map(report => (
            <button key={report.kind} type="button" className="report-option" aria-pressed={kind === report.kind} onClick={() => { setKind(report.kind); setGenerated(null); setError(''); }}>
              <strong>{report.title}</strong><small>{report.description}</small>
            </button>
          ))}
        </section>

        <section className="filter-bar" aria-label="Parâmetros">
          <div><label className="field-label" htmlFor="rep-obra">Obra</label>
            <select id="rep-obra" className="field-control" value={selection} onChange={event => { setSelection(event.target.value); setGenerated(null); }}>
              {(scope.isAdmin || scope.obraIds.length > 1) && <option value="ALL">{scope.isAdmin ? 'Todas as obras' : 'Todas as minhas obras'}</option>}
              {obras.filter(obra => scope.obraIds.includes(obra.id)).map(obra => <option key={obra.id} value={obra.id}>{obra.name}{obra.isActive ? '' : ' (inativa)'}</option>)}
            </select></div>
          {(kind === 'movements' || isOperation(kind)) && <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <div><label className="field-label" htmlFor="rep-from">De</label><input id="rep-from" type="date" className="field-control" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setGenerated(null); }} /></div>
            <div><label className="field-label" htmlFor="rep-to">Até</label><input id="rep-to" type="date" className="field-control" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setGenerated(null); }} /></div>
          </div>}
          <div className="flex items-end"><button type="button" className="primary-action w-full" disabled={loading} onClick={generate}>{loading ? 'Gerando…' : `Gerar ${reportTitle.toLowerCase()}`}</button></div>
        </section>

        {error && <div role="alert" className="notice notice-error">{error}</div>}
        {loading && <div className="flex justify-center py-8"><div className="spinner" /></div>}
        {generated?.unordered && <div role="status" className="notice notice-warn">O índice de consulta das movimentações ainda não existe no Firebase; o relatório pode estar incompleto. Publique o índice de <code>firestore.indexes.json</code>.</div>}
        {generated?.truncated && <div role="status" className="notice notice-warn">O limite de {MAX_MOVEMENTS} movimentações por consulta foi atingido. Reduza o período para um relatório completo.</div>}

        {generated && !loading && <section className="flex flex-col gap-3" aria-label="Prévia">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-slate-600"><strong>{rowCount}</strong> {rowCount === 1 ? 'linha' : 'linhas'} · prévia das {Math.min(PREVIEW_ROWS, rowCount)} primeiras</p>
            <button type="button" className="primary-action" disabled={rowCount === 0} onClick={download}><Download />Baixar CSV</button>
          </div>
          {rowCount === 0 ? <div className="empty-card"><FileSpreadsheet /><strong>Nenhum dado para este relatório</strong><span>Altere a obra, o período ou o tipo de relatório.</span></div> : (
            <div className="panel-card"><div className="overflow-x-auto"><table className="w-full text-sm text-left">
              {generated.receipts || generated.transfers || generated.returns || generated.counts ? <>
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Obra</th><th className="px-4 py-3">Item</th><th className="px-4 py-3 text-right">Qtd.</th><th className="px-4 py-3">Situação</th></tr></thead>
                <tbody className="divide-y divide-slate-200">{[
                  ...(generated.receipts ?? []).map(r => ({ id: r.id, date: r.receivedAt, obra: r.obraName, item: r.materialDescription, qty: r.quantity, status: 'Recebido' })),
                  ...(generated.transfers ?? []).map(t => ({ id: t.id, date: t.requestedAt.slice(0, 10), obra: `${t.fromObraName} → ${t.toObraName}`, item: t.materialDescription, qty: t.quantity, status: t.status })),
                  ...(generated.returns ?? []).map(r => ({ id: r.id, date: r.returnedAt, obra: r.obraName, item: r.materialDescription, qty: r.quantity, status: `${r.condition}${r.restocked ? ' (estoque)' : ''}` })),
                  ...(generated.counts ?? []).map(i => ({ id: i.id, date: i.createdAt.slice(0, 10), obra: obraName.get(i.obraId) ?? i.obraId, item: i.materialDescription, qty: i.difference, status: i.status })),
                ].slice(0, PREVIEW_ROWS).map(row => <tr key={row.id}><td className="px-4 py-3 whitespace-nowrap">{row.date}</td><td className="px-4 py-3">{row.obra}</td><td className="px-4 py-3">{row.item}</td><td className="px-4 py-3 text-right">{row.qty}</td><td className="px-4 py-3">{row.status}</td></tr>)}</tbody>
              </> : generated.movements ? <>
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200"><tr><th className="px-4 py-3">Data/hora</th><th className="px-4 py-3">Obra</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3 text-right">Qtd.</th><th className="px-4 py-3">Saldo</th></tr></thead>
                <tbody className="divide-y divide-slate-200">{generated.movements.slice(0, PREVIEW_ROWS).map(row => (
                  <tr key={row.id}><td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.createdAt) || '—'}</td><td className="px-4 py-3">{row.obraName ?? obraName.get(row.obraId) ?? row.obraId}</td><td className="px-4 py-3">{row.materialDescription || '—'}</td><td className="px-4 py-3">{row.typeLabel}</td><td className="px-4 py-3 text-right">{formatSignedQuantity(row.quantity) || '—'}</td><td className="px-4 py-3 whitespace-nowrap">{formatBalance(row) || '—'}</td></tr>
                ))}</tbody>
              </> : <>
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200"><tr><th className="px-4 py-3">Obra</th><th className="px-4 py-3">Item</th><th className="px-4 py-3 text-right">Saldo</th><th className="px-4 py-3 text-right">Mínimo</th><th className="px-4 py-3">Situação</th></tr></thead>
                <tbody className="divide-y divide-slate-200">{(generated.stocks ?? []).slice(0, PREVIEW_ROWS).map(row => (
                  <tr key={`${row.obraId}__${row.materialId}`}><td className="px-4 py-3">{row.obraName}</td><td className="px-4 py-3 font-medium text-slate-900">{row.materialDescription}</td><td className="px-4 py-3 text-right">{row.quantity} {row.unit}</td><td className="px-4 py-3 text-right">{row.minimumStock} {row.unit}</td><td className="px-4 py-3">{STOCK_LEVEL_LABEL[stockLevel(row)]}</td></tr>
                ))}</tbody>
              </>}
            </table></div></div>
          )}
        </section>}
      </>}
    </div>
  );
}
