export type UserRole = 'admin' | 'storekeeper';

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  companyId: string;
  companyName?: string;
  role: UserRole;
  assignedObraIds: string[]; // ['ALL'] or specific obra IDs
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
  reason?: string;
  createdAt: string;
  createdBy: string;
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
