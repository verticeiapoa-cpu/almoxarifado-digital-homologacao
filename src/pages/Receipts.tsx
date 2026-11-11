import { useMemo, useRef, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import { db } from '../lib/firebase';
import { registerReceipt, newOperationId } from '../lib/operationsService';
import { parseQuantity } from '../lib/operations';
import { ConfirmPanel, Feedback, ItemPicker, NoAccess, ObraField, PageHeader, Step, today, useGuardedAction, useOperationContext, useStocks } from '../components/OperationUi';

export default function Receipts() {
  const ctx = useOperationContext();
  const [reload, setReload] = useState(0);
  const { stocks, loading, error: loadError } = useStocks(ctx.scope, ctx.obraId, reload);
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [receivedAt, setReceivedAt] = useState(today());
  const [supplier, setSupplier] = useState(''); const [invoice, setInvoice] = useState(''); const [lot, setLot] = useState(''); const [expiresAt, setExpiresAt] = useState(''); const [notes, setNotes] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [formError, setFormError] = useState('');
  const operationId = useRef(newOperationId(db, 'receipts'));
  const guard = useGuardedAction();
  const stock = useMemo(() => stocks.find(s => s.materialId === materialId), [stocks, materialId]);
  if (!ctx.profile || !ctx.actor) return null;
  if (ctx.accessibleObras.length === 0) return <NoAccess />;

  const review = () => {
    setFormError('');
    try { parseQuantity(quantity, 'Quantidade que chegou'); } catch (e) { setFormError((e as Error).message); return; }
    setReviewing(true);
  };
  const submit = async () => {
    if (!stock || !ctx.obra) return;
    const ok = await guard.run(async () => {
      await registerReceipt(db, stock.materialId, {
        operationId: operationId.current, obraId: ctx.obra!.id, obraName: ctx.obra!.name, quantity: parseQuantity(quantity), receivedAt,
        supplier, invoiceNumber: invoice, lot, expiresAt: expiresAt || undefined, notes, expectedQuantity: stock.quantity,
      }, ctx.actor!);
    }, 'Pronto! O material foi registrado e o estoque já está atualizado.');
    if (ok) { operationId.current = newOperationId(db, 'receipts'); setReviewing(false); setMaterialId(''); setQuantity(''); setSupplier(''); setInvoice(''); setLot(''); setExpiresAt(''); setNotes(''); setReload(n => n + 1); }
    else setReviewing(false);
  };
  const qty = /^\d+$/.test(quantity.trim()) ? Number(quantity) : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Chegou material" text="Use quando chegar material na obra. Preencha como se fosse a ficha de papel — o estoque é atualizado sozinho." />
      <Step n={1} title="Em qual obra chegou?"><ObraField ctx={ctx} label="Obra" /></Step>
      <Step n={2} title="O que chegou?">
        <ItemPicker id="rc-mat" label="Item" stocks={stocks} value={materialId} onChange={id => { setMaterialId(id); setReviewing(false); }} />
        {!loading && stocks.length === 0 && ctx.obraId && !loadError && <div className="notice notice-warn">Esta obra ainda não tem itens cadastrados. Cadastre o item em “Estoque” antes de registrar a chegada.</div>}
        {loadError && <div role="alert" className="notice notice-error">{loadError}</div>}
      </Step>
      <Step n={3} title="Quanto chegou?">
        <div><label className="field-label" htmlFor="rc-qty">Quantidade que chegou{stock ? ` (${stock.unit})` : ''}</label>
          <input id="rc-qty" inputMode="numeric" autoComplete="off" className="field-control" value={quantity} onChange={e => { setQuantity(e.target.value); setReviewing(false); }} placeholder="Ex.: 20" /></div>
        <div><label className="field-label" htmlFor="rc-date">Data em que chegou</label><input id="rc-date" type="date" className="field-control" value={receivedAt} max={today()} onChange={e => setReceivedAt(e.target.value)} /></div>
        {stock && <p className="op-hint" role="status">Hoje no estoque: <strong>{stock.quantity} {stock.unit}</strong>{qty > 0 ? ` → depois de registrar: ${stock.quantity + qty} ${stock.unit}` : ''}</p>}
      </Step>
      <Step n={4} title="Dados da nota (se tiver)">
        <p className="op-hint">Pode deixar em branco. Servem só para consulta depois.</p>
        <div><label className="field-label" htmlFor="rc-sup">Fornecedor</label><input id="rc-sup" className="field-control" maxLength={120} value={supplier} onChange={e => setSupplier(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-nf">Número da nota fiscal</label><input id="rc-nf" className="field-control" maxLength={60} value={invoice} onChange={e => setInvoice(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-lot">Lote</label><input id="rc-lot" className="field-control" maxLength={60} value={lot} onChange={e => setLot(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-exp">Validade</label><input id="rc-exp" type="date" className="field-control" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="rc-obs">Observação</label><input id="rc-obs" className="field-control" maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </Step>
      {formError && <div role="alert" className="notice notice-error">{formError}</div>}
      <Feedback error={guard.error} success={guard.success} />
      {reviewing && stock ? (
        <ConfirmPanel title="Confira antes de registrar" busy={guard.busy} confirmLabel="Confirmar chegada" onBack={() => setReviewing(false)} onConfirm={submit}
          lines={[`Obra: ${ctx.obra?.name ?? ''}`, `Item: ${stock.materialDescription}`, `Chegaram: ${qty} ${stock.unit}`, `Estoque vai de ${stock.quantity} para ${stock.quantity + qty} ${stock.unit}`, ...(invoice.trim() ? [`Nota fiscal: ${invoice.trim()}`] : [])]} />
      ) : (
        <button type="button" className="primary-action" style={{ minHeight: 52, fontSize: '1rem' }} disabled={!stock || !quantity.trim()} onClick={review}><PackagePlus />Revisar e registrar</button>
      )}
    </div>
  );
}
