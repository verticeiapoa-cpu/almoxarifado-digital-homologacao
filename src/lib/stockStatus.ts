// Classificação de situação do estoque, somente para APRESENTAÇÃO.
// Não grava nada e não altera a regra de alerta existente:
// "abaixo do mínimo" continua sendo minimumStock > 0 && quantity <= minimumStock.

export type StockLevel = 'out' | 'critical' | 'low' | 'ok';

export interface StockLike {
  quantity: number;
  minimumStock: number;
}

export const STOCK_LEVEL_LABEL: Record<StockLevel, string> = {
  out: 'SEM SALDO',
  critical: 'CRÍTICO',
  low: 'ESTOQUE BAIXO',
  ok: 'NORMAL',
};

export const STOCK_LEVEL_HELP: Record<StockLevel, string> = {
  out: 'Saldo zerado.',
  critical: 'Saldo igual ou inferior à metade do mínimo.',
  low: 'Saldo igual ou inferior ao mínimo.',
  ok: 'Saldo acima do mínimo (ou mínimo não configurado).',
};

// Maior número = mais grave. Usado para ordenar listas.
export const STOCK_LEVEL_SEVERITY: Record<StockLevel, number> = { out: 3, critical: 2, low: 1, ok: 0 };

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function isBelowMinimum(stock: StockLike): boolean {
  const minimum = num(stock.minimumStock);
  return minimum > 0 && num(stock.quantity) <= minimum;
}

export function stockLevel(stock: StockLike): StockLevel {
  const quantity = num(stock.quantity);
  const minimum = num(stock.minimumStock);
  if (quantity <= 0) return 'out';
  if (minimum > 0 && quantity * 2 <= minimum) return 'critical';
  if (minimum > 0 && quantity <= minimum) return 'low';
  return 'ok';
}

export function compareBySeverity<T extends StockLike>(a: T, b: T): number {
  return STOCK_LEVEL_SEVERITY[stockLevel(b)] - STOCK_LEVEL_SEVERITY[stockLevel(a)];
}

// Cobertura = saldo / mínimo, limitada a 0..1 para a barra visual.
// Sem mínimo configurado não existe cobertura calculável (null).
export function coverageRatio(stock: StockLike): number | null {
  const minimum = num(stock.minimumStock);
  if (minimum <= 0) return null;
  return Math.max(0, Math.min(1, num(stock.quantity) / minimum));
}

export interface StockSummary {
  items: number;
  units: number;
  belowMinimum: number;
  byLevel: Record<StockLevel, number>;
}

export function summarizeStocks(stocks: StockLike[]): StockSummary {
  const summary: StockSummary = { items: stocks.length, units: 0, belowMinimum: 0, byLevel: { out: 0, critical: 0, low: 0, ok: 0 } };
  for (const stock of stocks) {
    summary.units += num(stock.quantity);
    if (isBelowMinimum(stock)) summary.belowMinimum += 1;
    summary.byLevel[stockLevel(stock)] += 1;
  }
  return summary;
}
