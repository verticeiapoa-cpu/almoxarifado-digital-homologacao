import { describe, expect, it } from 'vitest';
import { buildCsv } from '../src/lib/csv';
import { COUNT_ITEM_COLUMNS, RECEIPT_COLUMNS, RETURN_COLUMNS, TRANSFER_COLUMNS, filterCountItems, filterReceipts, filterReturns, filterTransfers } from '../src/lib/operationReports';
import type { DataScope } from '../src/lib/reports';
import type { InventoryCountItem, Receipt, ReturnRecord, Transfer } from '../src/types';

const scope: DataScope = { companyId: 'c1', isAdmin: false, obraIds: ['a'] };
const receipt = (over: Partial<Receipt> = {}): Receipt => ({ id: 'r', companyId: 'c1', obraId: 'a', obraName: 'A', materialId: 'm', materialDescription: 'CAPACETE', quantity: 5, unit: 'UN', receivedAt: '2026-09-10', balanceBefore: 1, balanceAfter: 6, movementId: 'x', status: 'CONCLUIDA', createdAt: '2026-09-10T12:00:00.000Z', createdBy: 'u', createdByName: 'U', ...over });
const transfer = (over: Partial<Transfer> = {}): Transfer => ({ id: 't', companyId: 'c1', fromObraId: 'a', fromObraName: 'A', toObraId: 'b', toObraName: 'B', materialId: 'm', materialDescription: 'CAPACETE', quantity: 2, unit: 'UN', status: 'PENDENTE', requestedBy: 'u', requestedByName: 'U', requestedAt: '2026-09-10T12:00:00.000Z', ...over });

describe('relatórios de operações', () => {
  it('recebimentos respeitam empresa, obra, período e material', () => {
    const rows = [receipt(), receipt({ id: 'r2', obraId: 'b' }), receipt({ id: 'r3', companyId: 'c2' }), receipt({ id: 'r4', receivedAt: '2026-08-01' }), receipt({ id: 'r5', materialId: 'z' })];
    expect(filterReceipts(rows, scope, {}).map(r => r.id)).toEqual(['r', 'r4', 'r5']);
    expect(filterReceipts(rows, scope, { fromDate: '2026-09-01', toDate: '2026-09-30', materialId: 'm' }).map(r => r.id)).toEqual(['r']);
  });
  it('transferências aparecem se origem OU destino está no escopo, nunca de outra empresa', () => {
    const rows = [transfer(), transfer({ id: 't2', fromObraId: 'x', toObraId: 'a' }), transfer({ id: 't3', fromObraId: 'x', toObraId: 'y' }), transfer({ id: 't4', companyId: 'c2' })];
    expect(filterTransfers(rows, scope, {}).map(t => t.id)).toEqual(['t', 't2']);
    expect(filterTransfers(rows, scope, { status: 'CONCLUIDA' })).toHaveLength(0);
  });
  it('devoluções filtram por condição; inventário filtra só ajustes', () => {
    const ret = { id: 'd', companyId: 'c1', obraId: 'a', returnedAt: '2026-09-10', materialId: 'm', condition: 'DANIFICADO', receivedBy: 'u' } as ReturnRecord;
    expect(filterReturns([ret, { ...ret, id: 'd2', condition: 'BOM_ESTADO' }], scope, { status: 'DANIFICADO' }).map(r => r.id)).toEqual(['d']);
    const item = { id: 'i', companyId: 'c1', obraId: 'a', materialId: 'm', createdAt: '2026-09-10T00:00:00.000Z', status: 'PENDENTE_AJUSTE', countedBy: 'u' } as InventoryCountItem;
    expect(filterCountItems([item, { ...item, id: 'i2', status: 'AJUSTADO' }], scope, {}, true).map(i => i.id)).toEqual(['i2']);
  });
  it('CSV: cabeçalhos, números negativos e proteção contra fórmula', () => {
    const csv = buildCsv(RECEIPT_COLUMNS, [receipt({ supplier: '=HYPERLINK("x")' })]);
    expect(csv.split('\r\n')[0]).toContain('Nota fiscal');
    expect(csv).toContain("'=HYPERLINK");
    expect(buildCsv(TRANSFER_COLUMNS, [transfer()]).split('\r\n')).toHaveLength(3);
    expect(buildCsv(RETURN_COLUMNS, []).split('\r\n')[0]).toContain('Voltou ao estoque');
    const item = { id: 'i', countId: 'c', difference: -3, createdAt: '2026-09-10T00:00:00.000Z' } as InventoryCountItem;
    expect(buildCsv(COUNT_ITEM_COLUMNS, [item])).toContain(';-3;');
  });
});
