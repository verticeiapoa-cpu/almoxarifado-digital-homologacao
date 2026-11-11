import { describe, expect, it } from 'vitest';
import { filterMovements, formatBalance, formatDateTime, formatSignedQuantity, normalizeMovement, periodBounds, responsibleLabel, sortMovementsDesc } from '../src/lib/movements';

const current = {
  companyId: 'c1', obraId: 'o1', obraName: 'Obra 1', materialId: 'm1', materialDescription: 'Luva',
  type: 'EPI_DELIVERY', quantity: -2, balanceBefore: 10, balanceAfter: 8, deliveryId: 'd1',
  createdAt: '2026-11-05T12:00:00.000Z', createdBy: 'uid-abcdef123456',
};

describe('normalização de movimentações', () => {
  it('lê o formato atual sem alterar valores', () => {
    const row = normalizeMovement('x', current)!;
    expect(row).toMatchObject({ type: 'EPI_DELIVERY', typeLabel: 'Entrega de EPI', quantity: -2, balanceBefore: 10, balanceAfter: 8, legacy: false, note: null });
  });
  it('lê o formato antigo sem inventar campos ausentes', () => {
    const row = normalizeMovement('old', { companyId: 'c1', obraId: 'o1', materialId: 'm1', movementType: 'ENTRY', quantity: 5, previousBalance: 1, newBalance: 6, reason: 'carga inicial', status: 'ok' })!;
    expect(row).toMatchObject({ type: 'ENTRY', quantity: 5, balanceBefore: 1, balanceAfter: 6, note: 'carga inicial', legacy: true, createdAt: null, createdBy: null, materialDescription: null });
  });
  it('mantém tipo desconhecido como "Outro" com o rótulo original', () => {
    const row = normalizeMovement('z', { companyId: 'c1', obraId: 'o1', movementType: 'perda' })!;
    expect(row.type).toBe('OTHER');
    expect(row.typeLabel).toBe('perda');
  });
  it('descarta registros sem empresa ou obra (não verificáveis)', () => {
    expect(normalizeMovement('a', { obraId: 'o1' })).toBeNull();
    expect(normalizeMovement('b', { companyId: 'c1' })).toBeNull();
  });
  it('converte Timestamp do Firestore e ignora datas inválidas', () => {
    const ts = { toDate: () => new Date('2026-01-02T03:04:05.000Z') };
    expect(normalizeMovement('t', { ...current, createdAt: ts })!.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(normalizeMovement('t', { ...current, createdAt: 'lixo' })!.createdAt).toBeNull();
  });
});

describe('filtros e ordenação', () => {
  const rows = [
    normalizeMovement('1', current)!,
    normalizeMovement('2', { ...current, obraId: 'o2', type: 'ENTRY', quantity: 4, balanceBefore: 8, balanceAfter: 12, createdAt: '2026-11-07T12:00:00.000Z' })!,
    normalizeMovement('3', { ...current, materialId: 'm2', createdAt: undefined })!,
  ];
  it('filtra por obra, material e tipo', () => {
    expect(filterMovements(rows, { obraId: 'o2' }).map(r => r.id)).toEqual(['2']);
    expect(filterMovements(rows, { materialId: 'm2' }).map(r => r.id)).toEqual(['3']);
    expect(filterMovements(rows, { type: 'ENTRY' }).map(r => r.id)).toEqual(['2']);
    expect(filterMovements(rows, { obraId: 'ALL' })).toHaveLength(3);
  });
  it('filtra por período e exclui registros sem data', () => {
    const only = filterMovements(rows, { fromIso: '2026-11-06T00:00:00.000Z', toIso: '2026-11-08T00:00:00.000Z' });
    expect(only.map(r => r.id)).toEqual(['2']);
  });
  it('ordena do mais recente ao mais antigo, sem data por último', () => {
    expect(sortMovementsDesc(rows).map(r => r.id)).toEqual(['2', '1', '3']);
  });
  it('converte datas do formulário em limites do dia inteiro', () => {
    const { fromIso, toIso } = periodBounds('2026-11-01', '2026-11-30');
    expect(Date.parse(toIso!) - Date.parse(fromIso!)).toBe(30 * 86400000 - 1);
    expect(periodBounds('', 'abc')).toEqual({});
  });
});

describe('formatação', () => {
  it('formata quantidade com sinal e saldo sem inventar valores', () => {
    expect(formatSignedQuantity(4)).toBe('+4');
    expect(formatSignedQuantity(-2)).toBe('-2');
    expect(formatSignedQuantity(null)).toBe('');
    expect(formatBalance({ balanceBefore: 10, balanceAfter: 8 })).toBe('10 → 8');
    expect(formatBalance({ balanceBefore: null, balanceAfter: 6 })).toBe('? → 6');
    expect(formatBalance({ balanceBefore: null, balanceAfter: null })).toBe('');
  });
  it('formata data no fuso de Brasília', () => {
    expect(formatDateTime('2026-11-05T12:00:00.000Z')).toContain('05/11/2026');
    expect(formatDateTime(null)).toBe('');
  });
  it('identifica o responsável sem inventar nomes', () => {
    const names = new Map([['u1', 'Maria']]);
    expect(responsibleLabel('u1', names, 'u9')).toBe('Maria');
    expect(responsibleLabel('u9', names, 'u9')).toBe('Você');
    expect(responsibleLabel('uid-abcdef123456', names)).toBe('Usuário …123456');
    expect(responsibleLabel(null, names)).toBe('');
  });

  it('Etapa 2: lê operationType/operationId e ignora valores desconhecidos', () => {
    const base = { companyId: 'c', obraId: 'o', type: 'ENTRY', quantity: 1 };
    expect(normalizeMovement('m1', { ...base, operationType: 'RECEIPT', operationId: 'r1' })).toMatchObject({ operationType: 'RECEIPT', operationId: 'r1' });
    expect(normalizeMovement('m2', { ...base, operationType: 'XYZ' })).toMatchObject({ operationType: null, operationId: null });
    expect(normalizeMovement('m3', base)).toMatchObject({ operationType: null });
  });
});
