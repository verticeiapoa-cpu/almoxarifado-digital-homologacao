import { describe, expect, it } from 'vitest';
import { coverageRatio, isBelowMinimum, stockLevel, summarizeStocks, compareBySeverity } from '../src/lib/stockStatus';

const s = (quantity: number, minimumStock: number) => ({ quantity, minimumStock });

describe('situação do estoque (apresentação)', () => {
  it('classifica saldo zerado como sem saldo, mesmo sem mínimo', () => {
    expect(stockLevel(s(0, 0))).toBe('out');
    expect(stockLevel(s(0, 10))).toBe('out');
  });
  it('classifica crítico até a metade do mínimo', () => {
    expect(stockLevel(s(5, 10))).toBe('critical');
    expect(stockLevel(s(1, 10))).toBe('critical');
  });
  it('classifica baixo entre a metade e o mínimo, inclusive no limite', () => {
    expect(stockLevel(s(6, 10))).toBe('low');
    expect(stockLevel(s(10, 10))).toBe('low');
  });
  it('classifica normal acima do mínimo ou sem mínimo configurado', () => {
    expect(stockLevel(s(11, 10))).toBe('ok');
    expect(stockLevel(s(3, 0))).toBe('ok');
  });
  it('mantém a regra de "abaixo do mínimo" idêntica à do alerta existente', () => {
    expect(isBelowMinimum(s(10, 10))).toBe(true);
    expect(isBelowMinimum(s(11, 10))).toBe(false);
    expect(isBelowMinimum(s(0, 0))).toBe(false);
  });
  it('trata valores inválidos como zero sem lançar erro', () => {
    expect(stockLevel({ quantity: NaN, minimumStock: undefined as unknown as number })).toBe('out');
  });
  it('limita a cobertura entre 0 e 1 e retorna nulo sem mínimo', () => {
    expect(coverageRatio(s(5, 10))).toBe(0.5);
    expect(coverageRatio(s(50, 10))).toBe(1);
    expect(coverageRatio(s(3, 0))).toBeNull();
  });
  it('resume contagens e unidades', () => {
    const summary = summarizeStocks([s(0, 5), s(2, 10), s(8, 10), s(30, 10)]);
    expect(summary).toEqual({ items: 4, units: 40, belowMinimum: 3, byLevel: { out: 1, critical: 1, low: 1, ok: 1 } });
  });
  it('ordena do mais grave para o menos grave', () => {
    const sorted = [s(30, 10), s(0, 10), s(8, 10)].sort(compareBySeverity);
    expect(sorted.map(item => item.quantity)).toEqual([0, 8, 30]);
  });
});
