import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { parseStockCount, prepareStockChange, saveMaterialStock, type SaveMaterialStockInput } from '../src/lib/inventory';
import type { InventoryStock } from '../src/types';

const adapter = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  rejectCommit: false,
  commits: [] as string[][],
  queries: [] as unknown[][],
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (parent: { path?: string }, collection?: string, id?: string) => ({ id: id || 'generated-movement', path: collection ? `${collection}/${id}` : `${parent.path}/generated-movement` }),
  where: (field: string, _op: string, value: string) => ({ field, value }),
  query: (ref: { path: string }, ...filters: { field: string; value: string }[]) => ({ ...ref, filters }),
  getDocsFromServer: async (ref: { path: string; filters: { field: string; value: string }[] }) => {
    adapter.queries.push(ref.filters);
    return { docs: [...adapter.documents].filter(([path, data]) => path.startsWith(`${ref.path}/`) && ref.filters.every(filter => data[filter.field] === filter.value))
      .map(([path, data]) => ({ id: path.split('/').at(-1), data: () => data })) };
  },
  runTransaction: async (_db: unknown, action: (tx: unknown) => Promise<unknown>) => {
    const writes: { path: string; data: Record<string, unknown>; update: boolean }[] = [];
    const result = await action({
      get: async (ref: { path: string }) => {
        // Reproduce the deployed resource.data-based rules for missing documents.
        if (!adapter.documents.has(ref.path)) throw Object.assign(new Error('Missing resource'), { code: 'permission-denied' });
        return { exists: () => true, data: () => adapter.documents.get(ref.path) };
      },
      set: (ref: { path: string }, data: Record<string, unknown>) => { writes.push({ path: ref.path, data, update: false }); },
      update: (ref: { path: string }, data: Record<string, unknown>) => { writes.push({ path: ref.path, data, update: true }); },
    });
    if (adapter.rejectCommit) throw Object.assign(new Error('Rejected'), { code: 'permission-denied' });
    for (const write of writes) {
      if (write.update && !adapter.documents.has(write.path)) throw new Error('not-found');
    }
    for (const write of writes) adapter.documents.set(write.path, write.update ? { ...adapter.documents.get(write.path), ...write.data } : write.data);
    adapter.commits.push(writes.map(write => write.path));
    return result;
  },
}));

vi.mock('../src/lib/firestoreCommit', () => ({
  commitDocuments: async (_db: unknown, writes: { path: string; data: Record<string, unknown>; exists: boolean; updateFields?: string[] }[]) => {
    if (adapter.rejectCommit) throw Object.assign(new Error('Rejected'), { code: 'permission-denied' });
    for (const write of writes) {
      if (adapter.documents.has(write.path) !== write.exists) throw Object.assign(new Error('Precondition'), { code: 'failed-precondition' });
    }
    for (const write of writes) adapter.documents.set(write.path, write.updateFields ? { ...adapter.documents.get(write.path), ...write.data } : write.data);
    adapter.commits.push(writes.map(write => write.path));
  },
}));

const input = (changes: Partial<SaveMaterialStockInput> = {}): SaveMaterialStockInput => ({
  material: { id: 'bota', description: 'BOTA', ca: '123455', companyId: 'wselent-default', isActive: true },
  isNewMaterial: true,
  obra: { id: 'obra-x', name: 'OBRA X', address: '', companyId: 'wselent-default', isActive: true },
  companyId: 'wselent-default', userId: 'admin', quantity: 400, minimumStock: 30,
  unit: 'PAR', expectedQuantity: null, ...changes,
});
const db = {} as Firestore;
beforeEach(() => { adapter.documents.clear(); adapter.commits = []; adapter.queries = []; adapter.rejectCommit = false; });

describe('valores digitados no smartphone', () => {
  it.each([['0400', 400], ['030', 30], ['0', 0], ['999999', 999999]])('interpreta %s como %i', (value, count) => {
    expect(parseStockCount(value, 'Saldo')).toBe(count);
  });
  it.each(['', '-1', '1.5', '1,5', '1e2', '12abc', '1000000', 'Infinity'])('rejeita %s sem truncar silenciosamente', value => {
    expect(() => parseStockCount(value, 'Saldo')).toThrow();
  });
});

describe('saldo por obra e histórico', () => {
  it('cria o primeiro saldo e o movimento correspondente', () => {
    const result = prepareStockChange(input(), undefined, 'now', 'movement');
    expect(result.stock).toMatchObject({ id: 'obra-x__bota', quantity: 400, minimumStock: 30 });
    expect(result.movement).toMatchObject({ type: 'ENTRY', quantity: 400, balanceBefore: 0, balanceAfter: 400 });
  });
  it('não inventa movimento quando só o mínimo muda', () => {
    const existing = prepareStockChange(input(), undefined, 'before', 'first').stock;
    const result = prepareStockChange(input({ expectedQuantity: 400, minimumStock: 40 }), existing, 'after', 'next');
    expect(result.movement).toBeUndefined();
    expect(result.stock.createdAt).toBe('before');
  });
  it('registra ajuste negativo com saldo anterior correto', () => {
    const existing = prepareStockChange(input(), undefined, 'before', 'first').stock;
    expect(prepareStockChange(input({ expectedQuantity: 400, quantity: 350 }), existing, 'after', 'next').movement)
      .toMatchObject({ type: 'ADJUSTMENT', quantity: -50, balanceBefore: 400, balanceAfter: 350 });
  });
  it('impede sobrescrever uma retirada concorrente', () => {
    const existing = { ...prepareStockChange(input(), undefined, 'before', 'first').stock, quantity: 399 };
    expect(() => prepareStockChange(input({ expectedQuantity: 400 }), existing, 'after', 'next')).toThrow('O saldo foi alterado');
  });
  it('impede reaproveitar saldo de outra obra', () => {
    const existing = { ...prepareStockChange(input(), undefined, 'before', 'first').stock, obraId: 'obra-y' };
    expect(() => prepareStockChange(input({ expectedQuantity: 400 }), existing, 'after', 'next')).toThrow('não pertence');
  });
  it('permite saldo zero inicial sem movimento de quantidade zero', () => {
    const result = prepareStockChange(input({ quantity: 0 }), undefined, 'now', 'movement');
    expect(result.stock.quantity).toBe(0);
    expect(result.movement).toBeUndefined();
  });
});

describe('salvamento transacional (adaptador de teste)', () => {
  it('persiste EPI, saldo e histórico na mesma transação', async () => {
    await saveMaterialStock(db, input());
    expect(adapter.commits).toEqual([['materials/bota', 'inventoryStock/obra-x__bota', 'stockMovements/generated-movement']]);
    expect(adapter.documents.get('inventoryStock/obra-x__bota')?.quantity).toBe(400);
    expect(adapter.queries[0]).toEqual([{ field: 'companyId', value: 'wselent-default' }, { field: 'obraId', value: 'obra-x' }, { field: 'materialId', value: 'bota' }]);
  });
  it('não deixa EPI ou saldo parcial quando a transação é recusada', async () => {
    adapter.rejectCommit = true;
    await expect(saveMaterialStock(db, input())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(adapter.documents.size).toBe(0);
    expect(adapter.commits).toEqual([]);
  });
  it('edita saldo preservando metadados do EPI e de criação', async () => {
    await saveMaterialStock(db, input());
    const original = adapter.documents.get('inventoryStock/obra-x__bota') as unknown as InventoryStock;
    const material = adapter.documents.get('materials/bota');
    await saveMaterialStock(db, input({ isNewMaterial: false, expectedQuantity: 400, quantity: 350 }));
    expect(adapter.documents.get('materials/bota')?.createdAt).toBe(material?.createdAt);
    expect(adapter.documents.get('inventoryStock/obra-x__bota')?.createdAt).toBe(original.createdAt);
    expect(adapter.documents.get('stockMovements/generated-movement')?.quantity).toBe(-50);
  });
  it('uma nova tentativa não duplica um primeiro saldo já confirmado', async () => {
    await saveMaterialStock(db, input());
    await expect(saveMaterialStock(db, input())).rejects.toThrow('O saldo foi alterado');
    expect(adapter.commits).toHaveLength(1);
  });
  it('cadastra o primeiro saldo de um EPI já existente sem substituir o catálogo', async () => {
    adapter.documents.set('materials/bota', { ...input().material, createdAt: 'original' });
    await saveMaterialStock(db, input({ isNewMaterial: false }));
    expect(adapter.documents.get('materials/bota')?.createdAt).toBe('original');
    expect(adapter.documents.get('inventoryStock/obra-x__bota')?.quantity).toBe(400);
  });
  it('mantém os saldos de outras obras independentes', async () => {
    adapter.documents.set('materials/bota', { ...input().material });
    adapter.documents.set('inventoryStock/obra-y__bota', { ...prepareStockChange(input(), undefined, 'before', 'y').stock, id: 'obra-y__bota', obraId: 'obra-y', quantity: 27 });
    await saveMaterialStock(db, input({ isNewMaterial: false }));
    expect(adapter.documents.get('inventoryStock/obra-y__bota')?.quantity).toBe(27);
    expect(adapter.documents.get('inventoryStock/obra-x__bota')?.quantity).toBe(400);
  });
});
