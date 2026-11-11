import { AlertTriangle, BellRing, CircleOff } from 'lucide-react';
import { cn } from './Layout';
import { STOCK_LEVEL_HELP, STOCK_LEVEL_LABEL, coverageRatio, type StockLevel, type StockLike } from '../lib/stockStatus';
import type { MovementType } from '../lib/movements';

const levelClass: Record<StockLevel, string> = {
  out: 'stock-status-out',
  critical: 'stock-status-critical',
  low: 'stock-status-low',
  ok: 'stock-status-ok',
};

export function StockLevelBadge({ level }: { level: StockLevel }) {
  return (
    <span className={cn('stock-status', levelClass[level])} title={STOCK_LEVEL_HELP[level]}>
      {level === 'out' ? <CircleOff /> : level === 'critical' ? <AlertTriangle /> : level === 'low' ? <BellRing /> : null}
      {STOCK_LEVEL_LABEL[level]}
    </span>
  );
}

export function CoverageBar({ stock, level }: { stock: StockLike; level: StockLevel }) {
  const ratio = coverageRatio(stock);
  if (ratio === null) return <span className="text-xs text-slate-400">Sem mínimo</span>;
  return (
    <div className="coverage" role="img" aria-label={`Saldo em ${Math.round(ratio * 100)}% do mínimo`}>
      <span className={cn('coverage-fill', `coverage-${level}`)} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 4 : 0)}%` }} />
    </div>
  );
}

const movementClass: Record<MovementType, string> = {
  ENTRY: 'mov-entry',
  EPI_DELIVERY: 'mov-delivery',
  TRANSFER: 'mov-transfer',
  ADJUSTMENT: 'mov-adjustment',
  RETURN: 'mov-return',
  OTHER: 'mov-other',
};

export function MovementTypeBadge({ type, label }: { type: MovementType; label: string }) {
  return <span className={cn('mov-badge', movementClass[type])}>{label}</span>;
}
