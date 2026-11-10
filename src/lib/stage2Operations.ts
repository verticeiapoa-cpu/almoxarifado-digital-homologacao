import { collection, doc, runTransaction, type Firestore } from 'firebase/firestore';
import type { InventoryStock, StockMovement } from '../types';

export interface ReceiveStockInput {
  companyId: string;
  obraId: string;
  obraName: string;
  materialId: string;
  materialDescription: string;
  ca: string;
  quantity: number;
  unit: string;
  minimumStock: number;
  reference: string;
  supplier?: string;
  lotNumber?: string;
  expiresAt?: string;
  notes?: string;
  userId: string;
}

const clean = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max);

function validate(input: ReceiveStockInput) {
  if (!input.companyId || !input.obraId || !input.materialId || !input.userId) {
    throw new Error('Empresa, obra, material e usuário são obrigatórios.');
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > 999999) {
    throw new Error('A quantidade recebida deve ser um inteiro entre 1 e 999999.');
  }
  if (!Number.isSafeInteger(input.minimumStock) || input.minimumStock < 0 || input.minimumStock > 999999) {
    throw new Error('O estoque mínimo deve ser um inteiro entre 0 e 999999.');
  }
  if (!clean(input.reference, 80)) throw new Error('Informe a nota fiscal ou referência do recebimento.');
  if (!clean(input.unit, 12)) throw new Error('Informe a unidade do material.');
  if (input.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) {
    throw new Error('A validade deve estar no formato AAAA-MM-DD.');
  }
}

export const inventoryStockId = (obraId: string, materialId: string) => `${obraId}__${materialId}`;

/**
 * Registers a receipt and its stock increase as one atomic Firestore transaction.
 * The receipt ID is generated once per invocation and is retained in the audit movement.
 * Firestore rules must restrict stockReceipts creation to administrators and validate
 * the corresponding inventoryStock and stockMovements writes in the same commit.
 */
export async function receiveStock(db: Firestore, input: ReceiveStockInput) {
  validate(input);
  const now = new Date().toISOString();
  const stockId = inventoryStockId(input.obraId, input.materialId);
  const stockRef = doc(db, 'inventoryStock', stockId);
  const receiptRef = doc(collection(db, 'stockReceipts'));
  const movementRef = doc(collection(db, 'stockMovements'));

  return runTransaction(db, async transaction => {
    const stockSnapshot = await transaction.get(stockRef);
    const previous = stockSnapshot.exists() ? stockSnapshot.data() as InventoryStock : undefined;
    if (previous && (
      previous.companyId !== input.companyId ||
      previous.obraId !== input.obraId ||
      previous.materialId !== input.materialId
    )) throw new Error('O saldo encontrado não corresponde à empresa, obra e material selecionados.');

    const before = previous?.quantity ?? 0;
    const after = before + input.quantity;
    if (!Number.isSafeInteger(after) || after > 999999) {
      throw new Error('O saldo resultante ultrapassa o limite permitido.');
    }

    const stock: InventoryStock = {
      id: stockId,
      companyId: input.companyId,
      obraId: input.obraId,
      obraName: input.obraName,
      materialId: input.materialId,
      materialDescription: input.materialDescription,
      ca: input.ca,
      quantity: after,
      minimumStock: input.minimumStock,
      unit: input.unit,
      lowStockAlertSent: false,
      ...(previous?.lastLowStockAlertAt ? { lastLowStockAlertAt: previous.lastLowStockAlertAt } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };

    const receipt = {
      id: receiptRef.id,
      companyId: input.companyId,
      obraId: input.obraId,
      obraName: input.obraName,
      materialId: input.materialId,
      materialDescription: input.materialDescription,
      ca: input.ca,
      stockId,
      quantity: input.quantity,
      unit: input.unit,
      reference: clean(input.reference, 80),
      supplier: clean(input.supplier, 120),
      lotNumber: clean(input.lotNumber, 80),
      expiresAt: clean(input.expiresAt, 10),
      notes: clean(input.notes, 300),
      balanceBefore: before,
      balanceAfter: after,
      createdAt: now,
      createdBy: input.userId,
    };

    const movement: StockMovement = {
      id: movementRef.id,
      companyId: input.companyId,
      obraId: input.obraId,
      obraName: input.obraName,
      materialId: input.materialId,
      materialDescription: input.materialDescription,
      type: 'ENTRY',
      quantity: input.quantity,
      balanceBefore: before,
      balanceAfter: after,
      createdAt: now,
      createdBy: input.userId,
    };

    if (stockSnapshot.exists()) transaction.update(stockRef, { ...stock });
    else transaction.set(stockRef, stock);
    transaction.set(receiptRef, receipt);
    transaction.set(movementRef, {
      ...movement,
      notes: `Recebimento ${receiptRef.id} — ${receipt.reference}`,
    });

    return { receiptId: receiptRef.id, movementId: movementRef.id, stock };
  });
}
