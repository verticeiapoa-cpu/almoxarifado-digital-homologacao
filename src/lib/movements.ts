// Normalização e filtros do histórico de movimentações (somente leitura).
// Nenhum documento é modificado. Campos ausentes continuam ausentes (null):
// nada é inventado ou deduzido.

export type MovementType = 'ENTRY' | 'EPI_DELIVERY' | 'TRANSFER' | 'ADJUSTMENT' | 'RETURN' | 'OTHER';

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  ENTRY: 'Entrada',
  EPI_DELIVERY: 'Entrega de EPI',
  TRANSFER: 'Transferência',
  ADJUSTMENT: 'Ajuste',
  RETURN: 'Devolução',
  OTHER: 'Outro',
};

const KNOWN_TYPES = new Set<string>(['ENTRY', 'EPI_DELIVERY', 'TRANSFER', 'ADJUSTMENT', 'RETURN']);

export interface MovementView {
  id: string;
  companyId: string;
  obraId: string;
  obraName: string | null;
  materialId: string | null;
  materialDescription: string | null;
  type: MovementType;
  typeLabel: string;
  quantity: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  deliveryId: string | null;
  note: string | null;
  createdAt: string | null;
  createdBy: string | null;
  // Etapa 2: operação que originou a movimentação (recebimento, transferência, devolução, inventário).
  operationType: 'RECEIPT' | 'TRANSFER' | 'RETURN' | 'INVENTORY' | null;
  operationId: string | null;
  // true quando o documento usa o formato antigo (movementType/previousBalance/newBalance).
  legacy: boolean;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const int = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function timestampToIso(value: unknown): string | null {
  if (typeof value === 'string') return Number.isNaN(Date.parse(value)) ? null : value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    try { return ((value as { toDate: () => Date }).toDate()).toISOString(); } catch { return null; }
  }
  return null;
}

export function normalizeMovement(id: string, raw: Record<string, unknown>): MovementView | null {
  const companyId = str(raw.companyId);
  const obraId = str(raw.obraId);
  // Sem empresa ou obra o registro não pode ser verificado contra o escopo do usuário.
  if (!companyId || !obraId) return null;

  const legacy = !('type' in raw) || str(raw.type) === null;
  const rawType = str(raw.type) ?? (str(raw.movementType)?.toUpperCase() ?? null);
  const type: MovementType = rawType && KNOWN_TYPES.has(rawType) ? (rawType as MovementType) : 'OTHER';
  const typeLabel = type === 'OTHER' && str(raw.movementType) ? String(raw.movementType).trim() : MOVEMENT_TYPE_LABEL[type];

  return {
    id,
    companyId,
    obraId,
    obraName: str(raw.obraName),
    materialId: str(raw.materialId),
    materialDescription: str(raw.materialDescription),
    type,
    typeLabel,
    quantity: int(raw.quantity),
    balanceBefore: int(raw.balanceBefore) ?? int(raw.previousBalance),
    balanceAfter: int(raw.balanceAfter) ?? int(raw.newBalance),
    deliveryId: str(raw.deliveryId),
    // O tipo do app grava "reason"; as regras atuais aceitam "notes". Exibe o que existir.
    note: str(raw.notes) ?? str(raw.reason),
    createdAt: timestampToIso(raw.createdAt),
    createdBy: str(raw.createdBy) ?? str(raw.requestedBy),
    operationType: ['RECEIPT', 'TRANSFER', 'RETURN', 'INVENTORY'].includes(String(raw.operationType)) ? raw.operationType as MovementView['operationType'] : null,
    operationId: str(raw.operationId),
    legacy,
  };
}

export const OPERATION_LABEL = { RECEIPT: 'Recebimento', TRANSFER: 'Transferência', RETURN: 'Devolução', INVENTORY: 'Inventário' } as const;
export const OPERATION_ROUTE = { RECEIPT: '/receipts', TRANSFER: '/transfers', RETURN: '/returns', INVENTORY: '/inventory-count' } as const;

export function sortMovementsDesc(rows: MovementView[]): MovementView[] {
  return [...rows].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : -Infinity;
    const tb = b.createdAt ? Date.parse(b.createdAt) : -Infinity;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Datas dos campos <input type="date"> (AAAA-MM-DD) para limites ISO no fuso do navegador.
export function periodBounds(fromDate?: string, toDate?: string): { fromIso?: string; toIso?: string } {
  const bounds: { fromIso?: string; toIso?: string } = {};
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) bounds.fromIso = new Date(`${fromDate}T00:00:00`).toISOString();
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) bounds.toIso = new Date(`${toDate}T23:59:59.999`).toISOString();
  return bounds;
}

export interface MovementFilters {
  obraId?: string;
  materialId?: string;
  type?: MovementType | '';
  fromIso?: string;
  toIso?: string;
}

export function filterMovements(rows: MovementView[], filters: MovementFilters): MovementView[] {
  const from = filters.fromIso ? Date.parse(filters.fromIso) : null;
  const to = filters.toIso ? Date.parse(filters.toIso) : null;
  return rows.filter(row => {
    if (filters.obraId && filters.obraId !== 'ALL' && row.obraId !== filters.obraId) return false;
    if (filters.materialId && row.materialId !== filters.materialId) return false;
    if (filters.type && row.type !== filters.type) return false;
    if (from !== null || to !== null) {
      // Sem data não é possível afirmar que o registro está no período.
      if (!row.createdAt) return false;
      const time = Date.parse(row.createdAt);
      if (from !== null && time < from) return false;
      if (to !== null && time > to) return false;
    }
    return true;
  });
}

const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : DATE_FORMAT.format(new Date(time));
}

export function formatSignedQuantity(quantity: number | null): string {
  if (quantity === null) return '';
  return quantity > 0 ? `+${quantity}` : String(quantity);
}

export function formatBalance(row: Pick<MovementView, 'balanceBefore' | 'balanceAfter'>): string {
  if (row.balanceBefore === null && row.balanceAfter === null) return '';
  return `${row.balanceBefore ?? '?'} → ${row.balanceAfter ?? '?'}`;
}

// Nome do responsável só quando conhecido; caso contrário, identificação parcial do UID.
export function responsibleLabel(uid: string | null, names: ReadonlyMap<string, string>, selfUid?: string): string {
  if (!uid) return '';
  if (selfUid && uid === selfUid) return 'Você';
  const name = names.get(uid);
  if (name) return name;
  return `Usuário …${uid.slice(-6)}`;
}
