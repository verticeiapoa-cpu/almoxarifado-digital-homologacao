import { describe, expect, it } from 'vitest';
import { buildCsv, csvFilename, escapeCsvCell } from '../src/lib/csv';

describe('exportação CSV', () => {
  it('cita campos com separador, aspas e quebra de linha', () => {
    expect(escapeCsvCell('a;b')).toBe('"a;b"');
    expect(escapeCsvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(escapeCsvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });
  it('neutraliza texto que o Excel interpretaria como fórmula', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('@SOMA(A1)')).toBe("'@SOMA(A1)");
    expect(escapeCsvCell('-cmd')).toBe("'-cmd");
    expect(escapeCsvCell('+55')).toBe("'+55");
  });
  it('mantém números reais, inclusive negativos, sem alteração', () => {
    expect(escapeCsvCell(-3)).toBe('-3');
    expect(escapeCsvCell(0)).toBe('0');
  });
  it('representa ausentes e números inválidos como célula vazia', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(NaN)).toBe('');
  });
  it('monta cabeçalho e linhas com CRLF final', () => {
    const csv = buildCsv([{ header: 'Item', value: (r: { n: string; q: number }) => r.n }, { header: 'Qtd', value: r => r.q }], [{ n: 'Luva; par', q: -2 }]);
    expect(csv).toBe('Item;Qtd\r\n"Luva; par";-2\r\n');
  });
  it('gera nome de arquivo seguro com data', () => {
    expect(csvFilename('Posição de estoque / Obra Á', new Date(2026, 10, 9))).toBe('posicao-de-estoque-obra-a-20261109.csv');
    expect(csvFilename('***', new Date(2026, 0, 2))).toBe('relatorio-20260102.csv');
  });
});
