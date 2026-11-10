import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { receiveStock } from '../src/lib/stage2Operations';
import { transferStock } from '../src/lib/stockTransfer';
import { registerStockReturn } from '../src/lib/stockReturns';
import { confirmInventoryCount } from '../src/lib/inventoryCount';

const adapter = vi.hoisted(() => ({
  docs: new Map<string, Record<string, any>>(),
  writes: [] as { path: string; kind: string; data: Record<string, any> }[],
  reject: false,
  sequence: 0,
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (parent: any, collectionOrId?: string, id?: string) => {
    if (id !== undefined) return { id, path: `${collectionOrId}/${id}` };
    if (collectionOrId !== undefined && parent?.path === undefined) return { id: collectionOrId, path: collectionOrId };
    adapter.sequence += 1;
    const generated = `generated-${adapter.sequence}`;
    return { id: generated, path: `${parent.path}/${generated}` };
  },
  runTransaction: async (_db: unknown, callback: (tx: any) => Promise<any>) => {
    const pending: { path: string; kind: string; data: Record<string, any> }[] = [];
    const tx = {
      get: async (ref: { path: string }) => {
        const value = adapter.docs.get(ref.path);
        return { exists: () => Boolean(value), data: () => value };
      },
      set: (ref: { path: string }, data: Record<string, any>) => pending.push({ path: ref.path, kind: 'set', data }),
      update: (ref: { path: string }, data: Record<string, any>) => pending.push({ path: ref.path, kind: 'update', data }),
    };
    const result = await callback(tx);
    if (adapter.reject) throw new Error('permission-denied');
    for (const write of pending) {
      if (write.kind === 'update' && !adapter.docs.has(write.path)) throw new Error('not-found');
    }
    for (const write of pending) {
      const previous = adapter.docs.get(write.path) ?? {};
      adapter.docs.set(write.path, write.kind === 'update' ? { ...previous, ...write.data } : write.data);
    }
    adapter.writes.push(...pending);
    return result;
  },
}));

const db = {} as Firestore;
const stock = (obraId: string, quantity: number) => ({
  id: `${obraId}__mat-1`, companyId: 'co-1', obraId, obraName: obraId.toUpperCase(),
  materialId: 'mat-1', materialDescription: 'Capacete', ca: '123',
  quantity, minimumStock: 2, unit: 'UN', lowStockAlertSent: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const base = { companyId: 'co-1', materialId: 'mat-1', materialDescription: 'Capacete', ca: '123', userId: 'admin' };

beforeEach(() => {
  adapter.docs.clear(); adapter.writes = []; adapter.reject = false; adapter.sequence = 0;
});

describe('Etapa 2 — recebimento', () => {
  it('cria saldo, comprovante e movimento ENTRY atomicamente', async () => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 10));
    const result = await receiveStock(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', quantity: 5, unit: 'UN', minimumStock: 2, reference: 'NF 123' });
    expect(adapter.docs.get('inventoryStock/obra-a__mat-1')?.quantity).toBe(15);
    expect(adapter.writes.map(w => w.path)).toEqual(['inventoryStock/obra-a__mat-1', `stockReceipts/${result.receiptId}`, `stockMovements/${result.movementId}`]);
    expect(adapter.docs.get(`stockMovements/${result.movementId}`)).toMatchObject({ type: 'ENTRY', quantity: 5, balanceBefore: 10, balanceAfter: 15, notes: expect.any(String) });
    expect(adapter.docs.get(`stockMovements/${result.movementId}`)).not.toHaveProperty('reason');
  });
  it('rejeita quantidade inválida sem gravar', async () => {
    await expect(receiveStock(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', quantity: 0, unit: 'UN', minimumStock: 0, reference: 'NF' })).rejects.toThrow();
    expect(adapter.writes).toHaveLength(0);
  });
});

describe('Etapa 2 — transferência', () => {
  it('debita origem e credita destino com dois movimentos', async () => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 10));
    const result = await transferStock(db, { ...base, sourceObraId: 'obra-a', sourceObraName: 'OBRA A', destinationObraId: 'obra-b', destinationObraName: 'OBRA B', quantity: 3, unit: 'UN', minimumStock: 1, reason: 'Redistribuição entre obras' });
    expect(adapter.docs.get('inventoryStock/obra-a__mat-1')?.quantity).toBe(7);
    expect(adapter.docs.get('inventoryStock/obra-b__mat-1')?.quantity).toBe(3);
    expect(adapter.docs.get(`stockTransfers/${result.transferId}`)).toMatchObject({ status: 'COMPLETED', sourceBalanceBefore: 10, sourceBalanceAfter: 7, destinationBalanceBefore: 0, destinationBalanceAfter: 3 });
    expect(adapter.writes.filter(w => w.path.startsWith('stockMovements/'))).toHaveLength(2);
  });
  it('impede saldo insuficiente e origem igual ao destino', async () => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 1));
    await expect(transferStock(db, { ...base, sourceObraId: 'obra-a', sourceObraName: 'A', destinationObraId: 'obra-b', destinationObraName: 'B', quantity: 2, unit: 'UN', minimumStock: 0, reason: 'Transferência teste' })).rejects.toThrow('Saldo insuficiente');
    await expect(transferStock(db, { ...base, sourceObraId: 'obra-a', sourceObraName: 'A', destinationObraId: 'obra-a', destinationObraName: 'A', quantity: 1, unit: 'UN', minimumStock: 0, reason: 'Transferência teste' })).rejects.toThrow('duas obras diferentes');
    expect(adapter.writes).toHaveLength(0);
  });
});

describe('Etapa 2 — devolução', () => {
  it('devolve item GOOD ao disponível e cria movimento RETURN', async () => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 4));
    const result = await registerStockReturn(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', quantity: 2, unit: 'UN', minimumStock: 1, condition: 'GOOD', destination: 'AVAILABLE', reason: 'Item conferido e íntegro' });
    expect(adapter.docs.get('inventoryStock/obra-a__mat-1')?.quantity).toBe(6);
    expect(adapter.docs.get(`stockReturns/${result.returnId}`)).toMatchObject({ destination: 'AVAILABLE', balanceBefore: 4, balanceAfter: 6 });
    expect(adapter.docs.get(`stockMovements/${result.movementId}`)).toMatchObject({ type: 'RETURN', quantity: 2, balanceBefore: 4, balanceAfter: 6 });
  });
  it.each(['QUARANTINE', 'DISCARDED'] as const)('registra %s sem aumentar saldo', async destination => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 4));
    const result = await registerStockReturn(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', quantity: 2, unit: 'UN', minimumStock: 1, condition: 'DAMAGED', destination, reason: 'Avaria identificada na inspeção' });
    expect(result.movementId).toBeNull();
    expect(adapter.docs.get('inventoryStock/obra-a__mat-1')?.quantity).toBe(4);
    expect(adapter.writes.some(w => w.path.startsWith('stockMovements/'))).toBe(false);
  });
  it('bloqueia material danificado em estoque disponível', async () => {
    await expect(registerStockReturn(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', quantity: 1, unit: 'UN', minimumStock: 0, condition: 'DAMAGED', destination: 'AVAILABLE', reason: 'Item com avaria' })).rejects.toThrow('Somente itens');
  });
});

describe('Etapa 2 — inventário físico', () => {
  it('registra contagem sem divergência sem movimento', async () => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 8));
    const result = await confirmInventoryCount(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', countedQuantity: 8, reason: 'Conferência mensal' });
    expect(result.difference).toBe(0);
    expect(adapter.docs.get(`inventoryCounts/${result.countId}`)).toMatchObject({ systemQuantity: 8, countedQuantity: 8, difference: 0 });
    expect(adapter.writes.some(w => w.path.startsWith('stockMovements/'))).toBe(false);
  });
  it('ajusta saldo e registra movimento ADJUSTMENT na mesma transação', async () => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 8));
    const result = await confirmInventoryCount(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', countedQuantity: 6, reason: 'Conferência física mensal' });
    expect(adapter.docs.get('inventoryStock/obra-a__mat-1')?.quantity).toBe(6);
    expect(adapter.docs.get(`stockMovements/${result.movementId}`)).toMatchObject({ type: 'ADJUSTMENT', quantity: -2, balanceBefore: 8, balanceAfter: 6 });
  });
  it('rejeita material/obra divergente e quantidade fracionada', async () => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 8));
    await expect(confirmInventoryCount(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', countedQuantity: 1.5, reason: 'Conferência física mensal' })).rejects.toThrow('inteiro');
    await expect(confirmInventoryCount(db, { ...base, obraId: 'obra-b', obraName: 'OBRA B', countedQuantity: 6, reason: 'Conferência física mensal' })).rejects.toThrow();
    expect(adapter.writes).toHaveLength(0);
  });
});

describe('Etapa 2 — atomicidade e limites', () => {
  it('não persiste nenhum documento quando a transação falha', async () => {
    adapter.docs.set('inventoryStock/obra-a__mat-1', stock('obra-a', 10));
    adapter.reject = true;
    await expect(receiveStock(db, { ...base, obraId: 'obra-a', obraName: 'OBRA A', quantity: 2, unit: 'UN', minimumStock: 0, reference: 'NF 1' })).rejects.toThrow('permission-denied');
    expect(adapter.docs.get('inventoryStock/obra-a__mat-1')?.quantity).toBe(10);
    expect(adapter.writes).toHaveLength(0);
  });
});
