import { describe, expect, it } from 'vitest';
import { buildCsv } from '../src/lib/csv';
import { normalizeMovement } from '../src/lib/movements';
import { STOCK_COLUMNS, buildDataScope, movementColumns, needsReplenishment, resolveObraTargets, restrictToScope, sortStockRows, type StockRow } from '../src/lib/reports';

const obras = [{ id: 'o1', companyId: 'c1' }, { id: 'o2', companyId: 'c1' }, { id: 'o3', companyId: 'c1' }, { id: 'x1', companyId: 'outra' }];
const admin = buildDataScope({ companyId: 'c1', role: 'admin', assignedObraIds: ['ALL'] }, obras);
const keeper = buildDataScope({ companyId: 'c1', role: 'storekeeper', assignedObraIds: ['o2'] }, obras);

describe('escopo de dados', () => {
  it('administrador vê todas as obras da própria empresa, nunca de outra', () => {
    expect(admin.obraIds).toEqual(['o1', 'o2', 'o3']);
  });
  it('almoxarife vê somente as obras atribuídas; "ALL" no perfil não concede nada', () => {
    expect(keeper.obraIds).toEqual(['o2']);
    expect(buildDataScope({ companyId: 'c1', role: 'storekeeper', assignedObraIds: ['ALL'] }, obras).obraIds).toEqual([]);
  });
  it('recusa obra fora do acesso', () => {
    expect(() => resolveObraTargets(keeper, 'o1')).toThrow();
    expect(() => resolveObraTargets(admin, 'x1')).toThrow();
  });
  it('"todas" é uma consulta de empresa para admin e uma consulta por obra para almoxarife', () => {
    expect(resolveObraTargets(admin, 'ALL')).toEqual([null]);
    expect(resolveObraTargets(keeper, 'ALL')).toEqual(['o2']);
    expect(resolveObraTargets(buildDataScope({ companyId: 'c1', role: 'storekeeper', assignedObraIds: [] }, obras), 'ALL')).toEqual([]);
  });
  it('descarta linhas de outra empresa ou de obra sem acesso', () => {
    const rows = [
      { companyId: 'c1', obraId: 'o2' }, { companyId: 'c1', obraId: 'o1' },
      { companyId: 'outra', obraId: 'o2' }, { companyId: 'c1' },
    ];
    expect(restrictToScope(rows, keeper)).toEqual([{ companyId: 'c1', obraId: 'o2' }]);
  });
});

const stock = (over: Partial<StockRow>): StockRow => ({
  companyId: 'c1', obraId: 'o1', obraName: 'Obra A', materialId: 'm', materialDescription: 'Item', ca: '', quantity: 10, minimumStock: 5, unit: 'UN', ...over,
});

describe('linhas de relatório', () => {
  it('lista só itens sem saldo, críticos ou abaixo do mínimo na reposição', () => {
    const rows = [stock({ materialDescription: 'A', quantity: 20 }), stock({ materialDescription: 'B', quantity: 5 }), stock({ materialDescription: 'C', quantity: 0, minimumStock: 0 })];
    expect(needsReplenishment(rows).map(r => r.materialDescription)).toEqual(['B', 'C']);
  });
  it('ordena por obra, gravidade e nome', () => {
    const rows = [stock({ obraName: 'B', materialDescription: 'x' }), stock({ obraName: 'A', materialDescription: 'z', quantity: 50 }), stock({ obraName: 'A', materialDescription: 'y', quantity: 0 })];
    expect(sortStockRows(rows).map(r => r.materialDescription)).toEqual(['y', 'z', 'x']);
  });
  it('exporta o estoque com situação textual e números como números', () => {
    const csv = buildCsv(STOCK_COLUMNS, [stock({ materialDescription: 'Luva', ca: '123', quantity: 2, minimumStock: 10 })]);
    expect(csv.split('\r\n')[0]).toBe('Obra;Item;C.A.;Saldo;Unidade;Mínimo;Situação;Atualizado em');
    expect(csv.split('\r\n')[1]).toBe('Obra A;Luva;123;2;UN;10;CRÍTICO;');
  });
  it('exporta movimentações deixando em branco o que não existe', () => {
    const row = normalizeMovement('m1', { companyId: 'c1', obraId: 'o1', movementType: 'ENTRY', quantity: 5 })!;
    const csv = buildCsv(movementColumns(new Map(), new Map([['o1', 'Obra A']])), [row]);
    expect(csv.split('\r\n')[1]).toBe(';;Obra A;;Entrada;5;;;;;;m1');
  });
});
