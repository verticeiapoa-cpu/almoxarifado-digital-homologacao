import { describe, expect, it } from 'vitest';
import {
  classifyCount, deliveryItemReturnable, movementId, outOfStockReturns, parseQuantity, planCountAdjustment, planCountClose, planCountHeader, planCountItem,
  planReceipt, planReturn, planReturnInspection, planTransferCancel, planTransferConfirm, planTransferRequest, type Actor,
} from '../src/lib/operations';
import type { Delivery, InventoryStock, ReturnLedger, ReturnRecord, Transfer } from '../src/types';

const NOW = '2026-09-10T12:00:00.000Z';
const actor: Actor = { uid: 'u1', name: 'Almoxarife', companyId: 'c1' };
const stock = (obraId: string, quantity: number, over: Partial<InventoryStock> = {}): InventoryStock => ({
  id: `${obraId}__m1`, companyId: 'c1', obraId, obraName: obraId.toUpperCase(), materialId: 'm1', materialDescription: 'CAPACETE', ca: '1',
  quantity, minimumStock: 5, unit: 'UN', lowStockAlertSent: true, createdAt: 'x', updatedAt: 'x', ...over,
});
const receiptInput = (over = {}) => ({ operationId: 'r1', obraId: 'a', obraName: 'A', quantity: 5, receivedAt: '2026-09-10', expectedQuantity: 10, ...over });

describe('parseQuantity', () => {
  it('aceita inteiros e recusa inválidos', () => {
    expect(parseQuantity('5')).toBe(5);
    for (const bad of ['0', '-1', '1.5', 'abc', '', '1000000']) expect(() => parseQuantity(bad)).toThrow();
    expect(parseQuantity('0', 'x', true)).toBe(0);
  });
});

describe('recebimento', () => {
  it('gera recebimento, movimentação ENTRY e aumento de saldo ligados por ID', () => {
    const plan = planReceipt(receiptInput({ supplier: 'ACME', invoiceNumber: '99', lot: 'L1', expiresAt: '2027-01-01' }), stock('a', 10), actor, NOW);
    expect(plan.receipt.balanceAfter).toBe(15);
    expect(plan.movement).toMatchObject({ type: 'ENTRY', quantity: 5, balanceBefore: 10, balanceAfter: 15, operationType: 'RECEIPT', operationId: 'r1' });
    expect(plan.movement.id).toBe(movementId('r1', 'a', 'm1'));
    expect(plan.receipt.movementId).toBe(plan.movement.id);
    expect(plan.writes.map(w => w.path)).toEqual(['receipts/r1', `stockMovements/${plan.movement.id}`, 'inventoryStock/a__m1']);
    expect(plan.writes[2].data).toMatchObject({ quantity: 15, lastMovementId: plan.movement.id, lowStockAlertSent: false });
  });
  it('não grava campos indefinidos nem informativos vazios', () => {
    const plan = planReceipt(receiptInput({ supplier: '  ' }), stock('a', 10), actor, NOW);
    expect('supplier' in plan.receipt).toBe(false);
    expect(Object.values(plan.receipt).includes(undefined as never)).toBe(false);
  });
  it('recusa quantidade inválida, saldo desatualizado, data inválida e estoque inexistente', () => {
    expect(() => planReceipt(receiptInput({ quantity: 0 }), stock('a', 10), actor, NOW)).toThrow();
    expect(() => planReceipt(receiptInput({ expectedQuantity: 9 }), stock('a', 10), actor, NOW)).toThrow(/alterado/);
    expect(() => planReceipt(receiptInput({ receivedAt: '10/09/2026' }), stock('a', 10), actor, NOW)).toThrow(/data/i);
    expect(() => planReceipt(receiptInput(), undefined, actor, NOW)).toThrow(/saldo cadastrado/);
    expect(() => planReceipt(receiptInput({ quantity: 999999 }), stock('a', 10), actor, NOW)).toThrow(/999999/);
  });
  it('não mantém lowStockAlertSent=false implícito quando ainda abaixo do mínimo', () => {
    const plan = planReceipt(receiptInput({ quantity: 1, expectedQuantity: 2 }), stock('a', 2), actor, NOW);
    expect('lowStockAlertSent' in plan.writes[2].data).toBe(false);
  });
});

const pending = (over: Partial<Transfer> = {}): Transfer => ({
  id: 't1', companyId: 'c1', fromObraId: 'a', fromObraName: 'A', toObraId: 'b', toObraName: 'B', materialId: 'm1', materialDescription: 'CAPACETE',
  quantity: 4, unit: 'UN', status: 'PENDENTE', requestedBy: 'u1', requestedByName: 'x', requestedAt: NOW, ...over,
});
const tInput = (over = {}) => ({ operationId: 't1', fromObraId: 'a', fromObraName: 'A', toObraId: 'b', toObraName: 'B', materialId: 'm1', materialDescription: 'CAPACETE', unit: 'UN', quantity: 4, ...over });

describe('transferência', () => {
  it('solicitação exige acesso às duas obras, obras distintas e quantidade válida', () => {
    expect(planTransferRequest(tInput(), ['a', 'b'], false, actor, NOW).transfer.status).toBe('PENDENTE');
    expect(() => planTransferRequest(tInput(), ['a'], false, actor, NOW)).toThrow(/duas obras/);
    expect(planTransferRequest(tInput(), [], true, actor, NOW).writes).toHaveLength(1);
    expect(() => planTransferRequest(tInput({ toObraId: 'a' }), ['a'], false, actor, NOW)).toThrow(/diferentes/);
    expect(() => planTransferRequest(tInput({ quantity: 0 }), ['a', 'b'], false, actor, NOW)).toThrow();
  });
  it('correção exige motivo', () => {
    expect(() => planTransferRequest(tInput({ correctsTransferId: 't0' }), ['a', 'b'], false, actor, NOW)).toThrow(/motivo/);
    expect(planTransferRequest(tInput({ correctsTransferId: 't0', notes: 'Erro de lançamento' }), ['a', 'b'], false, actor, NOW).transfer.correctsTransferId).toBe('t0');
  });
  it('confirmação baixa a origem e soma ao destino com duas movimentações TRANSFER', () => {
    const plan = planTransferConfirm(pending(), stock('a', 10), stock('b', 3), ['a', 'b'], false, actor, NOW);
    expect(plan.outMovement).toMatchObject({ quantity: -4, balanceBefore: 10, balanceAfter: 6, obraId: 'a' });
    expect(plan.inMovement).toMatchObject({ quantity: 4, balanceBefore: 3, balanceAfter: 7, obraId: 'b' });
    expect(plan.writes).toHaveLength(5);
    expect(plan.writes[0].data).toMatchObject({ status: 'CONCLUIDA', outMovementId: plan.outMovement.id, inMovementId: plan.inMovement.id });
  });
  it('bloqueia saldo insuficiente, destino sem estoque, duplicidade, cancelada e acesso parcial', () => {
    expect(() => planTransferConfirm(pending({ quantity: 11 }), stock('a', 10), stock('b', 3), ['a', 'b'], false, actor, NOW)).toThrow(/insuficiente/);
    expect(() => planTransferConfirm(pending(), stock('a', 10), undefined, ['a', 'b'], false, actor, NOW)).toThrow(/saldo cadastrado/);
    expect(() => planTransferConfirm(pending({ status: 'CONCLUIDA' }), stock('a', 10), stock('b', 3), ['a', 'b'], false, actor, NOW)).toThrow(/já foi concluída/);
    expect(() => planTransferConfirm(pending({ status: 'CANCELADA' }), stock('a', 10), stock('b', 3), ['a', 'b'], false, actor, NOW)).toThrow(/cancelada/);
    expect(() => planTransferConfirm(pending(), stock('a', 10), stock('b', 3), ['a'], false, actor, NOW)).toThrow(/duas obras/);
  });
  it('cancelamento: só pendente, com motivo', () => {
    expect(planTransferCancel(pending(), 'Pedido duplicado', ['a'], false, actor, NOW).writes[0].data).toMatchObject({ status: 'CANCELADA', cancelReason: 'Pedido duplicado' });
    expect(() => planTransferCancel(pending(), 'abc', ['a'], false, actor, NOW)).toThrow(/motivo/);
    expect(() => planTransferCancel(pending({ status: 'CONCLUIDA' }), 'Pedido duplicado', ['a'], false, actor, NOW)).toThrow(/correção/);
    expect(() => planTransferCancel(pending({ requestedBy: 'outro' }), 'Pedido duplicado', ['b'], false, actor, NOW)).toThrow(/não pode cancelar/);
  });
});

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1', timestamp: NOW, responsibleUser: 'u1', companyId: 'c1', obraId: 'a', stockObraId: 'a', employeeId: 'e1', employeeName: 'JOÃO', employeeCpf: '', employeeJobTitle: '',
  employeeObraName: 'A', employeeIsOutsourced: false, items: [{ materialId: 'm1', quantity: 3, description: 'CAPACETE', ca: '1' }], status: 'COMPLETED', createdAt: NOW, updatedAt: NOW, createdBy: 'u1', ...over,
});
const rInput = (over = {}) => ({ operationId: 'dv1', obraId: 'a', obraName: 'A', employeeId: 'e1', employeeName: 'JOÃO', materialId: 'm1', materialDescription: 'CAPACETE', quantity: 2, condition: 'BOM_ESTADO' as const, returnedAt: '2026-09-10', ...over });

describe('devolução', () => {
  it('bom estado devolve ao estoque com movimentação RETURN e atualiza o controle da entrega', () => {
    const plan = planReturn(rInput({ delivery: delivery(), deliveryItemIndex: 0 }), stock('a', 10), undefined, actor, NOW);
    expect(plan.record).toMatchObject({ restocked: true, balanceBefore: 10, balanceAfter: 12, deliveryId: 'd1' });
    expect(plan.movement).toMatchObject({ type: 'RETURN', quantity: 2, operationType: 'RETURN' });
    expect(plan.writes.map(w => w.path)).toEqual(['returns/dv1', 'returnLedger/d1__m1', `stockMovements/${plan.movement!.id}`, 'inventoryStock/a__m1']);
    expect(plan.writes[1].data).toMatchObject({ delivered: 3, returned: 2, lastReturnId: 'dv1' });
  });
  it('danificado e inservível não alteram o estoque disponível, mas geram registro auditável', () => {
    for (const condition of ['DANIFICADO', 'PENDENTE_INSPECAO'] as const) {
      const plan = planReturn(rInput({ condition }), undefined, undefined, actor, NOW);
      expect(plan.movement).toBeUndefined();
      expect(plan.record.restocked).toBe(false);
      expect(plan.writes.map(w => w.path)).toEqual(['returns/dv1']);
    }
    expect(() => planReturn(rInput({ condition: 'INSERVIVEL' }), undefined, undefined, actor, NOW)).toThrow(/motivo/);
    expect(planReturn(rInput({ condition: 'INSERVIVEL', notes: 'Rasgado por uso' }), undefined, undefined, actor, NOW).record.condition).toBe('INSERVIVEL');
  });
  it('impede devolver mais do que o entregue (considerando devoluções anteriores)', () => {
    const ledger: ReturnLedger = { id: 'd1__m1', companyId: 'c1', obraId: 'a', deliveryId: 'd1', materialId: 'm1', delivered: 3, returned: 2, lastReturnId: 'x', updatedAt: NOW, updatedBy: 'u1' };
    expect(deliveryItemReturnable(delivery(), 0, ledger).remaining).toBe(1);
    expect(() => planReturn(rInput({ delivery: delivery(), deliveryItemIndex: 0 }), stock('a', 10), ledger, actor, NOW)).toThrow(/restante 1/);
    expect(planReturn(rInput({ quantity: 1, delivery: delivery(), deliveryItemIndex: 0 }), stock('a', 10), ledger, actor, NOW).writes[1].data).toMatchObject({ returned: 3 });
  });
  it('valida vínculo com a entrega (colaborador, obra, item) e quantidade', () => {
    expect(() => planReturn(rInput({ delivery: delivery({ employeeId: 'e2' }), deliveryItemIndex: 0 }), stock('a', 10), undefined, actor, NOW)).toThrow(/outro colaborador/);
    expect(() => planReturn(rInput({ delivery: delivery({ stockObraId: 'b' }), deliveryItemIndex: 0 }), stock('a', 10), undefined, actor, NOW)).toThrow(/outra obra/);
    expect(() => planReturn(rInput({ delivery: delivery(), deliveryItemIndex: 3 }), stock('a', 10), undefined, actor, NOW)).toThrow(/não pertence/);
    expect(() => planReturn(rInput({ quantity: 0 }), stock('a', 10), undefined, actor, NOW)).toThrow();
  });
  it('bom estado sem estoque cadastrado é recusado', () => {
    expect(() => planReturn(rInput(), undefined, undefined, actor, NOW)).toThrow(/saldo cadastrado/);
  });
  it('inspeção: pendente vira bom estado (entra no estoque) ou fica fora', () => {
    const record = planReturn(rInput({ condition: 'PENDENTE_INSPECAO' }), undefined, undefined, actor, NOW).record;
    const good = planReturnInspection(record, 'BOM_ESTADO', undefined, stock('a', 10), actor, NOW);
    expect(good.movement).toMatchObject({ quantity: 2, balanceAfter: 12 });
    expect(good.writes[0].data).toMatchObject({ status: 'INSPECIONADA', restocked: true });
    const bad = planReturnInspection(record, 'DANIFICADO', 'Trincado', stock('a', 10), actor, NOW);
    expect(bad.movement).toBeUndefined();
    expect(bad.writes).toHaveLength(1);
    expect(() => planReturnInspection({ ...record, status: 'INSPECIONADA' }, 'BOM_ESTADO', undefined, stock('a', 10), actor, NOW)).toThrow();
    expect(() => planReturnInspection(record, 'INSERVIVEL', '', stock('a', 10), actor, NOW)).toThrow(/motivo/);
  });
  it('relatório de itens fora do estoque lista danificados, inservíveis e pendentes', () => {
    const base = planReturn(rInput({ condition: 'DANIFICADO' }), undefined, undefined, actor, NOW).record;
    const good = { ...base, id: 'g', condition: 'BOM_ESTADO' as const, restocked: true } as ReturnRecord;
    expect(outOfStockReturns([base, good]).map(r => r.id)).toEqual(['dv1']);
  });
});

describe('inventário físico', () => {
  const header = () => planCountHeader('c1', 'a', 'A', '2026-09-10', actor, NOW).count;
  it('classifica sem divergência e exige justificativa quando há diferença', () => {
    expect(classifyCount(10, 10)).toEqual({ difference: 0, status: 'SEM_DIVERGENCIA' });
    expect(classifyCount(10, 7, 'Perda identificada')).toEqual({ difference: -3, status: 'PENDENTE_AJUSTE' });
    expect(() => classifyCount(10, 7, '')).toThrow(/justificativa/);
  });
  it('registrar a contagem não altera o estoque', () => {
    const plan = planCountItem(header(), stock('a', 10), 7, 'Perda identificada', actor, NOW);
    expect(plan.item).toMatchObject({ systemQty: 10, countedQty: 7, difference: -3, status: 'PENDENTE_AJUSTE', id: 'c1__m1' });
    expect(plan.writes.map(w => w.path)).toEqual(['inventoryCountItems/c1__m1']);
    expect('justification' in planCountItem(header(), stock('a', 10), 10, undefined, actor, NOW).item).toBe(false);
  });
  it('ajuste exige permissão e saldo igual ao da contagem', () => {
    const item = planCountItem(header(), stock('a', 10), 7, 'Perda identificada', actor, NOW).item;
    expect(() => planCountAdjustment(item, stock('a', 10), false, 'A', actor, NOW)).toThrow(/permissão/);
    expect(() => planCountAdjustment(item, stock('a', 9), true, 'A', actor, NOW)).toThrow(/saldo mudou/);
    const plan = planCountAdjustment(item, stock('a', 10), true, 'A', actor, NOW);
    expect(plan.movement).toMatchObject({ type: 'ADJUSTMENT', quantity: -3, balanceBefore: 10, balanceAfter: 7, operationType: 'INVENTORY', operationId: 'c1' });
    expect(plan.writes[0].data).toMatchObject({ status: 'AJUSTADO', movementId: plan.movement.id });
    expect(() => planCountAdjustment({ ...item, status: 'AJUSTADO' }, stock('a', 10), true, 'A', actor, NOW)).toThrow(/já foi ajustado/);
  });
  it('contagem encerrada não aceita itens; confirmação exige permissão e nenhuma pendência', () => {
    expect(() => planCountItem({ ...header(), status: 'CONFIRMADA' }, stock('a', 10), 10, undefined, actor, NOW)).toThrow(/encerrada/);
    expect(() => planCountClose(header(), 'CONFIRMADA', 0, false, undefined, actor, NOW)).toThrow(/permissão/);
    expect(() => planCountClose(header(), 'CONFIRMADA', 2, true, undefined, actor, NOW)).toThrow(/pendente/);
    expect(planCountClose(header(), 'CONFIRMADA', 0, true, undefined, actor, NOW).writes[0].data).toMatchObject({ status: 'CONFIRMADA' });
    expect(() => planCountClose(header(), 'CANCELADA', 0, false, '', actor, NOW)).toThrow(/motivo/);
    expect(planCountClose(header(), 'CANCELADA', 3, false, 'Contagem errada', actor, NOW).writes[0].data).toMatchObject({ status: 'CANCELADA', cancelReason: 'Contagem errada' });
  });
});
