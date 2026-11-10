// Etapa 2 — relatórios CSV das operações (lógica pura). Escopo e filtros são aplicados antes da exportação.
import type { CsvColumn } from './csv';
import { formatDateTime } from './movements';
import { RETURN_CONDITION_LABEL } from './operations';
import { restrictToScope, type DataScope } from './reports';
import type { InventoryCountItem, Receipt, ReturnRecord, Transfer } from '../types';

export interface OperationFilters { fromDate?: string; toDate?: string; materialId?: string; responsibleUid?: string; status?: string }

const inRange = (date: string | undefined, f: OperationFilters) => {
  const day = (date ?? '').slice(0, 10);
  if (!f.fromDate && !f.toDate) return true;
  if (!day) return false;
  return (!f.fromDate || day >= f.fromDate) && (!f.toDate || day <= f.toDate);
};

export function filterReceipts(rows: Receipt[], scope: DataScope, f: OperationFilters) {
  return restrictToScope(rows, scope).filter(r => inRange(r.receivedAt, f) && (!f.materialId || r.materialId === f.materialId) && (!f.responsibleUid || r.createdBy === f.responsibleUid));
}

// Transferência visível se qualquer das duas obras está no escopo; a linha não vaza obra fora do escopo além do nome já gravado.
export function filterTransfers(rows: Transfer[], scope: DataScope, f: OperationFilters) {
  const allowed = new Set(scope.obraIds);
  return rows.filter(t => t.companyId === scope.companyId && (allowed.has(t.fromObraId) || allowed.has(t.toObraId))
    && inRange(t.requestedAt, f) && (!f.materialId || t.materialId === f.materialId) && (!f.responsibleUid || t.requestedBy === f.responsibleUid || t.confirmedBy === f.responsibleUid) && (!f.status || t.status === f.status));
}

export function filterReturns(rows: ReturnRecord[], scope: DataScope, f: OperationFilters) {
  return restrictToScope(rows, scope).filter(r => inRange(r.returnedAt, f) && (!f.materialId || r.materialId === f.materialId) && (!f.responsibleUid || r.receivedBy === f.responsibleUid) && (!f.status || r.condition === f.status));
}

export function filterCountItems(rows: InventoryCountItem[], scope: DataScope, f: OperationFilters, adjustmentsOnly = false) {
  return restrictToScope(rows, scope).filter(i => inRange(i.createdAt, f) && (!f.materialId || i.materialId === f.materialId)
    && (!f.responsibleUid || i.countedBy === f.responsibleUid || i.adjustedBy === f.responsibleUid) && (!adjustmentsOnly || i.status === 'AJUSTADO'));
}

export const RECEIPT_COLUMNS: CsvColumn<Receipt>[] = [
  { header: 'Data do recebimento', value: r => r.receivedAt }, { header: 'Obra', value: r => r.obraName }, { header: 'Item', value: r => r.materialDescription },
  { header: 'Quantidade', value: r => r.quantity }, { header: 'Unidade', value: r => r.unit }, { header: 'Fornecedor', value: r => r.supplier }, { header: 'Nota fiscal', value: r => r.invoiceNumber },
  { header: 'Lote', value: r => r.lot }, { header: 'Validade', value: r => r.expiresAt }, { header: 'Saldo anterior', value: r => r.balanceBefore }, { header: 'Saldo posterior', value: r => r.balanceAfter },
  { header: 'Responsável', value: r => r.createdByName }, { header: 'Registrado em', value: r => formatDateTime(r.createdAt) }, { header: 'Observação', value: r => r.notes }, { header: 'ID', value: r => r.id },
];

export const TRANSFER_COLUMNS: CsvColumn<Transfer>[] = [
  { header: 'Solicitada em', value: t => formatDateTime(t.requestedAt) }, { header: 'Origem', value: t => t.fromObraName }, { header: 'Destino', value: t => t.toObraName },
  { header: 'Item', value: t => t.materialDescription }, { header: 'Quantidade', value: t => t.quantity }, { header: 'Situação', value: t => t.status },
  { header: 'Solicitante', value: t => t.requestedByName }, { header: 'Confirmada por', value: t => t.confirmedByName }, { header: 'Confirmada em', value: t => formatDateTime(t.confirmedAt ?? null) },
  { header: 'Cancelada por', value: t => t.cancelledByName }, { header: 'Motivo do cancelamento', value: t => t.cancelReason }, { header: 'Observação', value: t => t.notes }, { header: 'ID', value: t => t.id },
];

export const RETURN_COLUMNS: CsvColumn<ReturnRecord>[] = [
  { header: 'Data da devolução', value: r => r.returnedAt }, { header: 'Obra', value: r => r.obraName }, { header: 'Colaborador', value: r => r.employeeName }, { header: 'Item', value: r => r.materialDescription },
  { header: 'Quantidade', value: r => r.quantity }, { header: 'Condição', value: r => RETURN_CONDITION_LABEL[r.condition] }, { header: 'Situação', value: r => r.status },
  { header: 'Voltou ao estoque', value: r => (r.restocked ? 'Sim' : 'Não') }, { header: 'Entrega de origem', value: r => r.deliveryId }, { header: 'Recebido por', value: r => r.receivedByName },
  { header: 'Inspecionado por', value: r => r.resolvedByName }, { header: 'Resolução', value: r => r.resolution }, { header: 'Observação', value: r => r.notes ?? r.resolutionNotes }, { header: 'ID', value: r => r.id },
];

export const COUNT_ITEM_COLUMNS: CsvColumn<InventoryCountItem>[] = [
  { header: 'Contagem', value: i => i.countId }, { header: 'Data', value: i => formatDateTime(i.createdAt) }, { header: 'Item', value: i => i.materialDescription },
  { header: 'Saldo do sistema', value: i => i.systemQty }, { header: 'Quantidade contada', value: i => i.countedQty }, { header: 'Diferença', value: i => i.difference },
  { header: 'Situação', value: i => i.status }, { header: 'Justificativa', value: i => i.justification }, { header: 'Saldo anterior ao ajuste', value: i => i.balanceBefore },
  { header: 'Saldo final', value: i => i.balanceAfter }, { header: 'Ajustado por', value: i => i.adjustedByName }, { header: 'Ajustado em', value: i => formatDateTime(i.adjustedAt ?? null) }, { header: 'ID da movimentação', value: i => i.movementId },
];
