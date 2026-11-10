// Escopo de acesso e montagem de linhas de relatório (lógica pura, sem Firebase).
import type { CsvColumn } from './csv';
import { formatBalance, formatDateTime, formatSignedQuantity, responsibleLabel, type MovementView } from './movements';
import { STOCK_LEVEL_LABEL, compareBySeverity, stockLevel } from './stockStatus';

export interface DataScope {
  companyId: string;
  isAdmin: boolean;
  // Obras que o usuário pode ler. Administrador: todas da empresa. Almoxarife: somente as atribuídas.
  obraIds: string[];
}

interface ScopeProfile { companyId: string; role: string; assignedObraIds: string[] }

export function buildDataScope(profile: ScopeProfile, obras: Array<{ id: string; companyId?: string }>): DataScope {
  const isAdmin = profile.role === 'admin';
  const sameCompany = obras.filter(obra => !obra.companyId || obra.companyId === profile.companyId);
  const ids = isAdmin
    ? sameCompany.map(obra => obra.id)
    : sameCompany.filter(obra => profile.assignedObraIds.includes(obra.id)).map(obra => obra.id);
  return { companyId: profile.companyId, isAdmin, obraIds: ids };
}

// Retorna as consultas necessárias: um ID de obra por consulta, ou null para
// "toda a empresa" (permitido somente ao administrador, como nas regras do Firestore).
export function resolveObraTargets(scope: DataScope, selection: string): Array<string | null> {
  if (selection !== 'ALL') {
    if (!scope.obraIds.includes(selection)) throw new Error('A obra selecionada está fora do seu acesso.');
    return [selection];
  }
  return scope.isAdmin ? [null] : [...scope.obraIds];
}

// Defesa adicional antes de exibir ou exportar: descarta qualquer linha fora da empresa/obras do usuário.
export function restrictToScope<T extends { companyId?: string; obraId?: string }>(rows: T[], scope: DataScope): T[] {
  const allowed = new Set(scope.obraIds);
  return rows.filter(row => row.companyId === scope.companyId && typeof row.obraId === 'string' && allowed.has(row.obraId));
}

export interface StockRow {
  companyId: string;
  obraId: string;
  obraName: string;
  materialId: string;
  materialDescription: string;
  ca: string;
  quantity: number;
  minimumStock: number;
  unit: string;
  updatedAt?: string;
}

export const STOCK_COLUMNS: CsvColumn<StockRow>[] = [
  { header: 'Obra', value: row => row.obraName },
  { header: 'Item', value: row => row.materialDescription },
  { header: 'C.A.', value: row => row.ca },
  { header: 'Saldo', value: row => row.quantity },
  { header: 'Unidade', value: row => row.unit },
  { header: 'Mínimo', value: row => row.minimumStock },
  { header: 'Situação', value: row => STOCK_LEVEL_LABEL[stockLevel(row)] },
  { header: 'Atualizado em', value: row => formatDateTime(row.updatedAt ?? null) },
];

export function sortStockRows<T extends StockRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.obraName.localeCompare(b.obraName, 'pt-BR')
    || compareBySeverity(a, b)
    || a.materialDescription.localeCompare(b.materialDescription, 'pt-BR'));
}

// Itens que merecem reposição: sem saldo, crítico ou abaixo do mínimo.
export function needsReplenishment<T extends StockRow>(rows: T[]): T[] {
  return rows.filter(row => stockLevel(row) !== 'ok');
}

export function movementColumns(names: ReadonlyMap<string, string>, obraNames: ReadonlyMap<string, string>, selfUid?: string): CsvColumn<MovementView>[] {
  return [
    { header: 'Data/hora', value: row => formatDateTime(row.createdAt) },
    { header: 'Data (ISO)', value: row => row.createdAt },
    { header: 'Obra', value: row => row.obraName ?? obraNames.get(row.obraId) ?? row.obraId },
    { header: 'Item', value: row => row.materialDescription },
    { header: 'Tipo', value: row => row.typeLabel },
    { header: 'Quantidade', value: row => row.quantity },
    { header: 'Saldo anterior', value: row => row.balanceBefore },
    { header: 'Saldo posterior', value: row => row.balanceAfter },
    { header: 'Responsável', value: row => responsibleLabel(row.createdBy, names, selfUid) },
    { header: 'Entrega', value: row => row.deliveryId },
    { header: 'Observação', value: row => row.note },
    { header: 'ID da movimentação', value: row => row.id },
  ];
}

export { formatBalance, formatSignedQuantity };
