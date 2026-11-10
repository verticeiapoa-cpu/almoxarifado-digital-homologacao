// Geração de CSV sem dependências externas.
// Separador ";" e BOM UTF-8 para abrir corretamente no Excel em português.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

const FORMULA_START = /^[=+\-@\t\r]/;

// Células de texto que começam com = + - @ podem ser executadas como fórmula no Excel.
// Números reais (type number) são gravados sem alteração, inclusive negativos.
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map(column => escapeCsvCell(column.header)).join(';')];
  for (const row of rows) lines.push(columns.map(column => escapeCsvCell(column.value(row))).join(';'));
  return lines.join('\r\n') + '\r\n';
}

export function csvFilename(base: string, date: Date = new Date()): string {
  const safe = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'relatorio';
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${safe}-${stamp}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
