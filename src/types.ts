export type UserRole = 'admin' | 'storekeeper';

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  companyId: string;
  companyName?: string;
  role: UserRole;
  assignedObraIds: string[]; // ['ALL'] or specific obra IDs
  // Definido pelo administrador. Autoriza o almoxarife a confirmar ajustes de inventário.
  // Ausente = false. Administradores sempre podem ajustar.
  canAdjustStock?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserInvitation {
  email: string;
  name: string;
  companyId: string;
  companyName?: string;
  role: UserRole;
  assignedObraIds: string[];
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  acceptedByUid?: string;
}

export interface Obra {
  id: string;
  name: string;
  address: string;
  cno?: string;
  companyId?: string;
  isActive: boolean;
}

export interface Employee {
  id: string;
  name: string;
  cpf: string;
  jobTitle: string;
  obraId: string;
  obraName: string;
  obraCno?: string;
  companyId?: string;
  isOutsourced: boolean;
  isActive: boolean;
}

export interface Department {
  id: string;
  name: string;
  companyId?: string;
  isActive: boolean;
}

export interface Material {
  id: string;
  ca: string;
  description: string;
  companyId?: string;
  isActive: boolean;
  stockQuantity?: number;
  minimumStock?: number;
  unit?: string;
  lowStockAlertSent?: boolean;
  lastLowStockAlertAt?: string;
}

export interface InventoryStock {
  id: string;
  companyId: string;
  obraId: string;
  obraName: string;
  materialId: string;
  materialDescription: string;
  ca: string;
  quantity: number;
  minimumStock: number;
  unit: string;
  lowStockAlertSent: boolean;
  lastLowStockAlertAt?: string;
  // Movimentação que originou o último aumento/ajuste de saldo feito por operação da Etapa 2.
  lastMovementId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemporaryAssignment {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  homeObraId: string;
  homeObraName: string;
  hostObraId: string;
  hostObraName: string;
  startsAt: unknown;
  endsAt: unknown;
  reason: string;
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface StockMovement {
  id: string;
  companyId: string;
  obraId: string;
  obraName: string;
  materialId: string;
  materialDescription: string;
  type: 'ENTRY' | 'EPI_DELIVERY' | 'TRANSFER' | 'ADJUSTMENT' | 'RETURN';
  quantity: number;
  balanceBefore: number;
  balanceAfter: number;
  deliveryId?: string;
  // As regras do Firestore aceitam "notes". "reason" existe apenas em documentos do formato antigo.
  notes?: string;
  // Operação de origem (Etapa 2). Ausente em movimentações antigas e em entregas de EPI.
  operationType?: OperationType;
  operationId?: string;
  createdAt: string;
  createdBy: string;
}

export type OperationType = 'RECEIPT' | 'TRANSFER' | 'RETURN' | 'INVENTORY';

export interface Receipt {
  id: string;
  companyId: string;
  obraId: string;
  obraName: string;
  materialId: string;
  materialDescription: string;
  quantity: number;
  unit: string;
  receivedAt: string; // AAAA-MM-DD
  supplier?: string;
  invoiceNumber?: string;
  lot?: string;
  expiresAt?: string; // AAAA-MM-DD, informativo (sem saldo por lote)
  notes?: string;
  balanceBefore: number;
  balanceAfter: number;
  movementId: string;
  status: 'CONCLUIDA';
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export type TransferStatus = 'PENDENTE' | 'CONCLUIDA' | 'CANCELADA';

export interface Transfer {
  id: string;
  companyId: string;
  fromObraId: string;
  fromObraName: string;
  toObraId: string;
  toObraName: string;
  materialId: string;
  materialDescription: string;
  quantity: number;
  unit: string;
  status: TransferStatus;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  notes?: string;
  correctsTransferId?: string;
  confirmedBy?: string;
  confirmedByName?: string;
  confirmedAt?: string;
  outMovementId?: string;
  inMovementId?: string;
  cancelledBy?: string;
  cancelledByName?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export type ReturnCondition = 'BOM_ESTADO' | 'DANIFICADO' | 'INSERVIVEL' | 'PENDENTE_INSPECAO';

export interface ReturnRecord {
  id: string;
  companyId: string;
  obraId: string;
  obraName: string;
  employeeId: string;
  employeeName: string;
  deliveryId?: string;
  deliveryItemIndex?: number;
  materialId: string;
  materialDescription: string;
  quantity: number;
  condition: ReturnCondition;
  status: 'REGISTRADA' | 'INSPECIONADA';
  returnedAt: string; // AAAA-MM-DD
  receivedBy: string;
  receivedByName: string;
  notes?: string;
  restocked: boolean;
  movementId?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  resolution?: Exclude<ReturnCondition, 'PENDENTE_INSPECAO'>;
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  createdAt: string;
  createdBy: string;
}

// Controle da quantidade já devolvida por entrega e material (chave: {deliveryId}__{materialId}).
export interface ReturnLedger {
  id: string;
  companyId: string;
  obraId: string;
  deliveryId: string;
  materialId: string;
  delivered: number;
  returned: number;
  lastReturnId: string;
  updatedAt: string;
  updatedBy: string;
}

export interface InventoryCount {
  id: string;
  companyId: string;
  obraId: string;
  obraName: string;
  countedAt: string; // AAAA-MM-DD
  countedBy: string;
  countedByName: string;
  status: 'EM_CONTAGEM' | 'CONFIRMADA' | 'CANCELADA';
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  closedBy?: string;
  closedAt?: string;
  cancelReason?: string;
}

export type InventoryItemStatus = 'SEM_DIVERGENCIA' | 'PENDENTE_AJUSTE' | 'AJUSTADO';

// Chave: {countId}__{materialId}
export interface InventoryCountItem {
  id: string;
  countId: string;
  companyId: string;
  obraId: string;
  materialId: string;
  materialDescription: string;
  unit: string;
  systemQty: number; // saldo usado como referência na contagem
  countedQty: number;
  difference: number; // countedQty - systemQty
  justification?: string; // obrigatória quando difference != 0
  status: InventoryItemStatus;
  countedBy: string;
  createdAt: string;
  createdBy: string;
  balanceBefore?: number;
  balanceAfter?: number;
  movementId?: string;
  adjustedBy?: string;
  adjustedByName?: string;
  adjustedAt?: string;
}

export interface StockAlertSettings {
  id: string;
  companyId: string;
  recipientEmail: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DeliveryItem {
  materialId?: string;
  stockId?: string;
  quantity: number | '';
  description: string;
  ca: string;
}

export interface Delivery {
  id: string;
  timestamp: string; // ISO 8601
  responsibleUser: string; // the logged in user
  companyId?: string;
  obraId?: string;
  employeeHomeObraId?: string;
  employeeHomeObraName?: string;
  employeeHomeObraCno?: string;
  serviceObraId?: string;
  serviceObraName?: string;
  stockObraId?: string;
  stockObraName?: string;
  isFloatingEmployee?: boolean;
  temporaryAssignmentId?: string;
  temporaryAssignmentReason?: string;
  
  employeeId: string;
  employeeName: string;
  employeeCpf: string;
  employeeJobTitle: string;
  employeeObraName: string;
  employeeIsOutsourced: boolean;
  
  items: DeliveryItem[];
  
  status: 'PENDING_SYNC' | 'COMPLETED' | 'FAILED_SYNC';
  signatureUrl?: string; // base64 or file URL
  signatureHash?: string;
  audit?: {
    authUid: string;
    authEmail: string;
    signedAt: string;
    signatureMethod: 'drawn-on-screen';
    consentText: string;
    userAgent?: string;
  };
  serverCreatedAt?: unknown;
  pdfUrl?: string; // path to the generated PDF
  driveFileId?: string; // ID in Google Drive
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
