// Etapa 2 — regras de negócio puras (sem Firebase) das operações de estoque:
// recebimento, transferência entre obras, devolução e inventário físico.
// Cada função "plan*" valida os dados e devolve a lista de escritas que uma única
// transação deve aplicar. O saldo disponível só muda por escrita ligada a uma movimentação.
import type {
  InventoryCount, InventoryCountItem, InventoryStock, ReturnCondition, ReturnLedger, ReturnRecord, Receipt,
  StockMovement, Transfer, Delivery,
} from '../types';

export interface PlannedWrite { path: string; kind: 'set' | 'update'; data: Record<string, unknown> }
export interface Actor { uid: string; name: string; companyId: string }

export const MAX_QUANTITY = 999999;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const RETURN_CONDITION_LABEL: Record<ReturnCondition, string> = {
  BOM_ESTADO: 'Bom estado (volta ao estoque)',
  DANIFICADO: 'Danificado (fora do estoque)',
  INSERVIVEL: 'Inservível (descarte)',
  PENDENTE_INSPECAO: 'Pendente de inspeção',
};

export const movementId = (operationId: string, obraId: string, materialId: string) => `${operationId}__${obraId}__${materialId}`;
export const stockId = (obraId: string, materialId: string) => `${obraId}__${materialId}`;

// Firestore rejeita undefined: remove chaves sem valor.
const clean = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
const text = (value: string | undefined) => (value ?? '').trim();
const optional = (value: string | undefined) => (text(value) ? text(value) : undefined);

export function parseQuantity(raw: string | number, label = 'Quantidade', allowZero = false): number {
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  const ok = Number.isSafeInteger(value) && value <= MAX_QUANTITY && (allowZero ? value >= 0 : value >= 1) && /^\d+$/.test(String(raw).trim());
  if (!ok) throw new Error(`${label}: informe um número inteiro ${allowZero ? 'entre 0' : 'entre 1'} e ${MAX_QUANTITY}.`);
  return value;
}

export function assertIsoDate(value: string, label: string) {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error(`${label}: informe uma data válida.`);
}

function assertStockOf(stock: InventoryStock | undefined, companyId: string, obraId: string, materialId: string, obraLabel = 'a obra'): InventoryStock {
  if (!stock) throw new Error(`Este item ainda não tem saldo cadastrado em ${obraLabel}. Cadastre o item na obra pela tela de Estoque antes de continuar.`);
  if (stock.companyId !== companyId || stock.obraId !== obraId || stock.materialId !== materialId) throw new Error('O saldo não pertence ao item e à obra selecionados.');
  return stock;
}

function stockWrite(stock: InventoryStock, quantity: number, lastMovementId: string, now: string): PlannedWrite {
  const data: Record<string, unknown> = { quantity, lastMovementId, updatedAt: now };
  // Reposição acima do mínimo reabre o ciclo de alerta, igual ao comportamento existente.
  if (stock.minimumStock <= 0 || quantity > stock.minimumStock) data.lowStockAlertSent = false;
  return { path: `inventoryStock/${stock.id}`, kind: 'update', data };
}

function movement(op: { type: StockMovement['type']; operationType: NonNullable<StockMovement['operationType']>; operationId: string }, stock: InventoryStock, delta: number, actor: Actor, now: string, obraName: string, notes?: string): StockMovement {
  return clean({
    id: movementId(op.operationId, stock.obraId, stock.materialId), companyId: actor.companyId, obraId: stock.obraId, obraName,
    materialId: stock.materialId, materialDescription: stock.materialDescription, type: op.type, quantity: delta,
    balanceBefore: stock.quantity, balanceAfter: stock.quantity + delta, operationType: op.operationType, operationId: op.operationId,
    notes: optional(notes), createdAt: now, createdBy: actor.uid,
  }) as StockMovement;
}

const movementWrite = (m: StockMovement): PlannedWrite => ({ path: `stockMovements/${m.id}`, kind: 'set', data: { ...m } });

// ---------- Recebimento ----------
export interface ReceiptInput {
  operationId: string; obraId: string; obraName: string; quantity: number; receivedAt: string;
  supplier?: string; invoiceNumber?: string; lot?: string; expiresAt?: string; notes?: string; expectedQuantity: number;
}

export function planReceipt(input: ReceiptInput, stock: InventoryStock | undefined, actor: Actor, now: string) {
  const current = assertStockOf(stock, actor.companyId, input.obraId, stock?.materialId ?? '', input.obraName);
  parseQuantity(input.quantity);
  assertIsoDate(input.receivedAt, 'Data do recebimento');
  if (input.expiresAt) assertIsoDate(input.expiresAt, 'Validade');
  if (current.quantity !== input.expectedQuantity) throw new Error('O saldo foi alterado enquanto você preenchia o recebimento. Reabra a tela para conferir o saldo atualizado.');
  if (current.quantity + input.quantity > MAX_QUANTITY) throw new Error(`O saldo final não pode passar de ${MAX_QUANTITY}.`);
  const mv = movement({ type: 'ENTRY', operationType: 'RECEIPT', operationId: input.operationId }, current, input.quantity, actor, now, input.obraName,
    input.invoiceNumber ? `Recebimento NF ${text(input.invoiceNumber)}` : 'Recebimento');
  const receipt = clean({
    id: input.operationId, companyId: actor.companyId, obraId: input.obraId, obraName: input.obraName, materialId: current.materialId,
    materialDescription: current.materialDescription, quantity: input.quantity, unit: current.unit, receivedAt: input.receivedAt,
    supplier: optional(input.supplier), invoiceNumber: optional(input.invoiceNumber), lot: optional(input.lot), expiresAt: optional(input.expiresAt), notes: optional(input.notes),
    balanceBefore: current.quantity, balanceAfter: mv.balanceAfter, movementId: mv.id, status: 'CONCLUIDA' as const,
    createdAt: now, createdBy: actor.uid, createdByName: actor.name,
  }) as Receipt;
  return { receipt, movement: mv, writes: [
    { path: `receipts/${receipt.id}`, kind: 'set', data: { ...receipt } },
    movementWrite(mv),
    stockWrite(current, mv.balanceAfter, mv.id, now),
  ] as PlannedWrite[] };
}

// ---------- Transferência ----------
export interface TransferRequestInput {
  operationId: string; fromObraId: string; fromObraName: string; toObraId: string; toObraName: string;
  materialId: string; materialDescription: string; unit: string; quantity: number; notes?: string; correctsTransferId?: string;
}

export function planTransferRequest(input: TransferRequestInput, accessibleObraIds: string[], isAdmin: boolean, actor: Actor, now: string) {
  parseQuantity(input.quantity);
  if (input.fromObraId === input.toObraId) throw new Error('A obra de origem e a de destino devem ser diferentes.');
  const allowed = (id: string) => isAdmin || accessibleObraIds.includes(id);
  if (!allowed(input.fromObraId) || !allowed(input.toObraId)) throw new Error('Você precisa ter acesso às duas obras para transferir entre elas.');
  if (input.correctsTransferId && text(input.notes).length < 5) throw new Error('Informe o motivo da correção (mínimo de 5 caracteres).');
  const transfer = clean({
    id: input.operationId, companyId: actor.companyId, fromObraId: input.fromObraId, fromObraName: input.fromObraName,
    toObraId: input.toObraId, toObraName: input.toObraName, materialId: input.materialId, materialDescription: input.materialDescription,
    unit: input.unit, quantity: input.quantity, status: 'PENDENTE' as const, requestedBy: actor.uid, requestedByName: actor.name, requestedAt: now,
    notes: optional(input.notes), correctsTransferId: input.correctsTransferId,
  }) as Transfer;
  return { transfer, writes: [{ path: `transfers/${transfer.id}`, kind: 'set', data: { ...transfer } }] as PlannedWrite[] };
}

export function planTransferConfirm(transfer: Transfer, source: InventoryStock | undefined, destination: InventoryStock | undefined, accessibleObraIds: string[], isAdmin: boolean, actor: Actor, now: string) {
  if (transfer.status !== 'PENDENTE') throw new Error(transfer.status === 'CONCLUIDA' ? 'Esta transferência já foi concluída.' : 'Esta transferência foi cancelada e não pode ser confirmada.');
  if (!isAdmin && !(accessibleObraIds.includes(transfer.fromObraId) && accessibleObraIds.includes(transfer.toObraId))) throw new Error('Você precisa ter acesso às duas obras para confirmar a transferência.');
  const from = assertStockOf(source, actor.companyId, transfer.fromObraId, transfer.materialId, transfer.fromObraName);
  const to = assertStockOf(destination, actor.companyId, transfer.toObraId, transfer.materialId, transfer.toObraName);
  if (from.quantity < transfer.quantity) throw new Error(`Saldo insuficiente na obra de origem: disponível ${from.quantity}, solicitado ${transfer.quantity}.`);
  if (to.quantity + transfer.quantity > MAX_QUANTITY) throw new Error(`O saldo do destino não pode passar de ${MAX_QUANTITY}.`);
  const note = `Transferência ${transfer.fromObraName} → ${transfer.toObraName}`;
  const out = movement({ type: 'TRANSFER', operationType: 'TRANSFER', operationId: transfer.id }, from, -transfer.quantity, actor, now, transfer.fromObraName, note);
  const inn = movement({ type: 'TRANSFER', operationType: 'TRANSFER', operationId: transfer.id }, to, transfer.quantity, actor, now, transfer.toObraName, note);
  return { outMovement: out, inMovement: inn, writes: [
    { path: `transfers/${transfer.id}`, kind: 'update', data: { status: 'CONCLUIDA', confirmedBy: actor.uid, confirmedByName: actor.name, confirmedAt: now, outMovementId: out.id, inMovementId: inn.id } },
    movementWrite(out), movementWrite(inn),
    stockWrite(from, out.balanceAfter, out.id, now), stockWrite(to, inn.balanceAfter, inn.id, now),
  ] as PlannedWrite[] };
}

export function planTransferCancel(transfer: Transfer, reason: string, accessibleObraIds: string[], isAdmin: boolean, actor: Actor, now: string) {
  if (transfer.status !== 'PENDENTE') throw new Error(transfer.status === 'CONCLUIDA' ? 'Transferência concluída não pode ser cancelada. Registre uma transferência de correção.' : 'Esta transferência já foi cancelada.');
  if (!isAdmin && transfer.requestedBy !== actor.uid && !accessibleObraIds.includes(transfer.fromObraId)) throw new Error('Você não pode cancelar esta transferência.');
  if (text(reason).length < 5) throw new Error('Informe o motivo do cancelamento (mínimo de 5 caracteres).');
  return { writes: [{ path: `transfers/${transfer.id}`, kind: 'update', data: { status: 'CANCELADA', cancelledBy: actor.uid, cancelledByName: actor.name, cancelledAt: now, cancelReason: text(reason) } }] as PlannedWrite[] };
}

// ---------- Devolução ----------
export const RETURN_MAX_ITEMS = 5;

export function deliveryItemReturnable(delivery: Delivery, itemIndex: number, ledger: ReturnLedger | undefined) {
  const item = delivery.items[itemIndex];
  const delivered = item && typeof item.quantity === 'number' ? item.quantity : 0;
  return { delivered, returned: ledger?.returned ?? 0, remaining: Math.max(0, delivered - (ledger?.returned ?? 0)) };
}

export interface ReturnInput {
  operationId: string; obraId: string; obraName: string; employeeId: string; employeeName: string; materialId: string;
  materialDescription: string; quantity: number; condition: ReturnCondition; returnedAt: string; notes?: string;
  delivery?: Delivery; deliveryItemIndex?: number;
}

export function planReturn(input: ReturnInput, stock: InventoryStock | undefined, ledger: ReturnLedger | undefined, actor: Actor, now: string) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 9999) throw new Error('Quantidade: informe um número inteiro entre 1 e 9999.');
  assertIsoDate(input.returnedAt, 'Data da devolução');
  if (input.condition === 'INSERVIVEL' && text(input.notes).length < 5) throw new Error('Para item inservível, descreva o motivo (mínimo de 5 caracteres).');
  const writes: PlannedWrite[] = [];
  let linked: Pick<ReturnRecord, 'deliveryId' | 'deliveryItemIndex'> = {};
  if (input.delivery) {
    const index = input.deliveryItemIndex ?? -1;
    const item = input.delivery.items[index];
    if (!item || item.materialId !== input.materialId) throw new Error('O item escolhido não pertence a esta entrega.');
    if (input.delivery.employeeId !== input.employeeId) throw new Error('A entrega pertence a outro colaborador.');
    if (input.delivery.stockObraId !== input.obraId) throw new Error('A entrega foi feita em outra obra.');
    const { delivered, returned, remaining } = deliveryItemReturnable(input.delivery, index, ledger);
    if (input.quantity > remaining) throw new Error(`Quantidade acima do devolvível: entregue ${delivered}, já devolvido ${returned}, restante ${remaining}.`);
    linked = { deliveryId: input.delivery.id, deliveryItemIndex: index };
    const nextLedger: ReturnLedger = { id: `${input.delivery.id}__${input.materialId}`, companyId: actor.companyId, obraId: input.obraId, deliveryId: input.delivery.id, materialId: input.materialId, delivered, returned: returned + input.quantity, lastReturnId: input.operationId, updatedAt: now, updatedBy: actor.uid };
    writes.push({ path: `returnLedger/${nextLedger.id}`, kind: 'set', data: { ...nextLedger } });
  }
  const restock = input.condition === 'BOM_ESTADO';
  let mv: StockMovement | undefined;
  if (restock) {
    const current = assertStockOf(stock, actor.companyId, input.obraId, input.materialId, input.obraName);
    if (current.quantity + input.quantity > MAX_QUANTITY) throw new Error(`O saldo final não pode passar de ${MAX_QUANTITY}.`);
    mv = movement({ type: 'RETURN', operationType: 'RETURN', operationId: input.operationId }, current, input.quantity, actor, now, input.obraName, `Devolução de ${input.employeeName}`);
    writes.push(movementWrite(mv), stockWrite(current, mv.balanceAfter, mv.id, now));
  }
  const record = clean({
    id: input.operationId, companyId: actor.companyId, obraId: input.obraId, obraName: input.obraName, employeeId: input.employeeId, employeeName: input.employeeName,
    ...linked, materialId: input.materialId, materialDescription: input.materialDescription, quantity: input.quantity, condition: input.condition,
    status: 'REGISTRADA' as const, returnedAt: input.returnedAt, receivedBy: actor.uid, receivedByName: actor.name, notes: optional(input.notes), restocked: restock,
    movementId: mv?.id, balanceBefore: mv?.balanceBefore, balanceAfter: mv?.balanceAfter, createdAt: now, createdBy: actor.uid,
  }) as ReturnRecord;
  writes.unshift({ path: `returns/${record.id}`, kind: 'set', data: { ...record } });
  return { record, movement: mv, writes };
}

export function planReturnInspection(record: ReturnRecord, resolution: 'BOM_ESTADO' | 'DANIFICADO' | 'INSERVIVEL', notes: string | undefined, stock: InventoryStock | undefined, actor: Actor, now: string) {
  if (record.condition !== 'PENDENTE_INSPECAO' || record.status !== 'REGISTRADA') throw new Error('Somente devoluções pendentes de inspeção podem ser resolvidas.');
  if (resolution === 'INSERVIVEL' && text(notes).length < 5) throw new Error('Para item inservível, descreva o motivo (mínimo de 5 caracteres).');
  const data: Record<string, unknown> = clean({ status: 'INSPECIONADA', resolution, resolvedBy: actor.uid, resolvedByName: actor.name, resolvedAt: now, resolutionNotes: optional(notes), restocked: resolution === 'BOM_ESTADO' });
  const writes: PlannedWrite[] = [];
  let mv: StockMovement | undefined;
  if (resolution === 'BOM_ESTADO') {
    const current = assertStockOf(stock, actor.companyId, record.obraId, record.materialId, record.obraName);
    if (current.quantity + record.quantity > MAX_QUANTITY) throw new Error(`O saldo final não pode passar de ${MAX_QUANTITY}.`);
    mv = movement({ type: 'RETURN', operationType: 'RETURN', operationId: record.id }, current, record.quantity, actor, now, record.obraName, `Devolução de ${record.employeeName} (inspecionada)`);
    Object.assign(data, { movementId: mv.id, balanceBefore: mv.balanceBefore, balanceAfter: mv.balanceAfter });
    writes.push(movementWrite(mv), stockWrite(current, mv.balanceAfter, mv.id, now));
  }
  writes.unshift({ path: `returns/${record.id}`, kind: 'update', data });
  return { movement: mv, writes };
}

// Itens fora do estoque disponível, para relatório: danificados/inservíveis e pendentes (derivado de returns).
export function outOfStockReturns(records: ReturnRecord[]) {
  return records.filter(r => !r.restocked && (r.status === 'REGISTRADA' || r.status === 'INSPECIONADA')
    && (r.status === 'REGISTRADA' ? true : r.resolution !== 'BOM_ESTADO'));
}

// ---------- Inventário físico ----------
export function planCountHeader(operationId: string, obraId: string, obraName: string, countedAt: string, actor: Actor, now: string) {
  assertIsoDate(countedAt, 'Data da contagem');
  const count: InventoryCount = { id: operationId, companyId: actor.companyId, obraId, obraName, countedAt, countedBy: actor.uid, countedByName: actor.name, status: 'EM_CONTAGEM', createdAt: now, createdBy: actor.uid, updatedAt: now };
  return { count, writes: [{ path: `inventoryCounts/${count.id}`, kind: 'set', data: { ...count } }] as PlannedWrite[] };
}

export function classifyCount(systemQty: number, countedQty: number, justification?: string) {
  const difference = countedQty - systemQty;
  if (difference === 0) return { difference, status: 'SEM_DIVERGENCIA' as const };
  if (text(justification).length < 5) throw new Error('Divergência encontrada: informe a justificativa (mínimo de 5 caracteres).');
  return { difference, status: 'PENDENTE_AJUSTE' as const };
}

export function planCountItem(count: InventoryCount, stock: InventoryStock | undefined, countedQty: number, justification: string | undefined, actor: Actor, now: string) {
  if (count.status !== 'EM_CONTAGEM') throw new Error('Esta contagem já foi encerrada.');
  const current = assertStockOf(stock, actor.companyId, count.obraId, stock?.materialId ?? '', count.obraName);
  parseQuantity(countedQty, 'Quantidade contada', true);
  const { difference, status } = classifyCount(current.quantity, countedQty, justification);
  const item = clean({
    id: `${count.id}__${current.materialId}`, countId: count.id, companyId: actor.companyId, obraId: count.obraId, materialId: current.materialId,
    materialDescription: current.materialDescription, unit: current.unit, systemQty: current.quantity, countedQty, difference,
    justification: difference === 0 ? undefined : text(justification), status, countedBy: actor.uid, createdAt: now, createdBy: actor.uid,
  }) as InventoryCountItem;
  return { item, writes: [{ path: `inventoryCountItems/${item.id}`, kind: 'set', data: { ...item } }] as PlannedWrite[] };
}

// Aplica o ajuste de um item pendente. Exige permissão e saldo igual ao da contagem (sem sobrescrever vendas concorrentes).
export function planCountAdjustment(item: InventoryCountItem, stock: InventoryStock | undefined, canAdjust: boolean, obraName: string, actor: Actor, now: string) {
  if (!canAdjust) throw new Error('Você não tem permissão para ajustar estoque. Peça ao administrador.');
  if (item.status !== 'PENDENTE_AJUSTE') throw new Error(item.status === 'AJUSTADO' ? 'Este item já foi ajustado.' : 'Este item não tem divergência para ajustar.');
  const current = assertStockOf(stock, actor.companyId, item.obraId, item.materialId, obraName);
  if (current.quantity !== item.systemQty) throw new Error(`O saldo mudou desde a contagem (contagem: ${item.systemQty}, atual: ${current.quantity}). Faça uma nova contagem deste item.`);
  const mv = movement({ type: 'ADJUSTMENT', operationType: 'INVENTORY', operationId: item.countId }, current, item.difference, actor, now, obraName, `Ajuste de inventário: ${item.justification ?? ''}`.trim());
  return { movement: mv, writes: [
    { path: `inventoryCountItems/${item.id}`, kind: 'update', data: { status: 'AJUSTADO', movementId: mv.id, balanceBefore: mv.balanceBefore, balanceAfter: mv.balanceAfter, adjustedBy: actor.uid, adjustedByName: actor.name, adjustedAt: now } },
    movementWrite(mv), stockWrite(current, mv.balanceAfter, mv.id, now),
  ] as PlannedWrite[] };
}

export function planCountClose(count: InventoryCount, status: 'CONFIRMADA' | 'CANCELADA', pendingItems: number, canAdjust: boolean, reason: string | undefined, actor: Actor, now: string) {
  if (count.status !== 'EM_CONTAGEM') throw new Error('Esta contagem já foi encerrada.');
  if (status === 'CONFIRMADA') {
    if (!canAdjust) throw new Error('Você não tem permissão para confirmar o inventário.');
    if (pendingItems > 0) throw new Error(`Ainda há ${pendingItems} ${pendingItems === 1 ? 'item com divergência pendente' : 'itens com divergência pendente'} de ajuste.`);
  } else if (text(reason).length < 5) throw new Error('Informe o motivo do cancelamento (mínimo de 5 caracteres).');
  return { writes: [{ path: `inventoryCounts/${count.id}`, kind: 'update', data: clean({ status, closedBy: actor.uid, closedAt: now, cancelReason: status === 'CANCELADA' ? text(reason) : undefined, updatedAt: now }) }] as PlannedWrite[] };
}
