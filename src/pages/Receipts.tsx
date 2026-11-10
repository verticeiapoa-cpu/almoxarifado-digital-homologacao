import { useMemo, useRef, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import { db } from '../lib/firebase';
import { registerReceipt, newOperationId } from '../lib/operationsService';
import { parseQuantity } from '../lib/operations';
import { Feedback, NoAccess, ObraField, PageHeader, today, useGuardedAction, useOperationContext, useStocks } from '../components/OperationUi';

export default function Receipts() {
  const ctx = useOperationContext();
  const [reload, setReload] = useState(0);
  const { stocks, loading, error: loadError } = useStocks(ctx.scope, ctx.obraId, reload);
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [receivedAt, setReceivedAt] = useState(today());
  const [supplier, setSupplier] = useState(''); const [invoice, setInvoice] = useState(''); const [lot, setLot] = useState(''); const [expiresAt, setExpiresAt] = useState(''); const [notes, setNotes] = useState('');
  const operationId = useRef(newOperationId(db, 'receipts'));
  const guard = useGuardedAction();
  const stock = useMemo(() => stocks.find(s => s.materialId === materialId), [stocks, materialId]);
  if (!ctx.profile || !ctx.actor) return null;
  if (ctx.accessibleObras.length === 0) return <NoAccess />;

  const submit = async () => {
    if (!stock || !ctx.obra) { return; }
    const ok = await guard.run(async () => {
      await registerReceipt(db, stock.materialId, {
        operationId: operationId.current, obraId: ctx.obra!.id, obraName: ctx.obra!.name, quantity: parseQuantity(quantity), receivedAt,
        supplier, invoiceNumber: invoice, lot, expiresAt: expiresAt || undefined, notes, expectedQuantity: stock.quantity,
      }, ctx.actor!);
    }, 'Recebimento registrado e saldo atualizado.');
    if (ok) { operationId.current = newOperationId(db, 'receipts'); setQuantity(''); setSupplier(''); setInvoice(''); setLot(''); setExpiresAt(''); setNotes(''); setReload(n => n + 1); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Recebimento" text="Registre a entrada de material na obra. Lote, validade, fornecedor e NF são apenas informativos." />
      <section className="filter-bar" aria-label="Dados do recebimento">
        <ObraField ctx={ctx} />
        <div><label className="field-label" htmlFor="rc-mat">Item</label>
          <select id="rc-mat" className="field-control" value={materialId} onChange={e => setMaterialId(e.target.value)} disabled={loading}>
            <option value="">Selecione o item</option>{stocks.map(s => <option key={s.materialId} value={s.materialId}>{s.materialDescription} (saldo {s.quantity} {s.unit})</option>)}
          </select></div>
        <div><label className="field-label" htmlFor="rc-qty">Quantidade recebida</label><input id="rc-qty" inputMode="numeric" className="field-control" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-date">Data do recebimento</label><input id="rc-date" type="date" className="field-control" value={receivedAt} max={today()} onChange={e => setReceivedAt(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-sup">Fornecedor (opcional)</label><input id="rc-sup" className="field-control" maxLength={120} value={supplier} onChange={e => setSupplier(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-nf">Nota fiscal (opcional)</label><input id="rc-nf" className="field-control" maxLength={60} value={invoice} onChange={e => setInvoice(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-lot">Lote (opcional)</label><input id="rc-lot" className="field-control" maxLength={60} value={lot} onChange={e => setLot(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-exp">Validade (opcional)</label><input id="rc-exp" type="date" className="field-control" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="rc-obs">Observação (opcional)</label><input id="rc-obs" className="field-control" maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </section>
      {stock && <p className="text-sm text-slate-600" role="status">Saldo atual: <strong>{stock.quantity} {stock.unit}</strong>{quantity && /^\d+$/.test(quantity) ? ` → após o recebimento: ${stock.quantity + Number(quantity)} ${stock.unit}` : ''}</p>}
      {!loading && stocks.length === 0 && ctx.obraId && !loadError && <div className="notice notice-warn">Nenhum item cadastrado nesta obra. Cadastre o item e o saldo inicial em Estoque antes de registrar recebimentos.</div>}
      {loadError && <div role="alert" className="notice notice-error">{loadError}</div>}
      <Feedback error={guard.error} success={guard.success} />
      <button type="button" className="primary-action" disabled={guard.busy || !stock || !quantity} onClick={submit}><PackagePlus />{guard.busy ? 'Registrando…' : 'Registrar recebimento'}</button>
    </div>
  );
}
