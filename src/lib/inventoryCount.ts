import { collection, doc, runTransaction, type Firestore } from 'firebase/firestore';
import type { InventoryStock } from '../types';
import { inventoryStockId } from './stage2Operations';

export interface ConfirmInventoryCountInput {
  companyId: string; obraId: string; obraName: string;
  materialId: string; materialDescription: string; ca: string;
  countedQuantity: number; reason: string; userId: string;
}

/** Confirms one count per transaction; stale counts fail instead of overwriting concurrent stock movements. */
export async function confirmInventoryCount(db: Firestore, input: ConfirmInventoryCountInput) {
  if (!input.companyId || !input.obraId || !input.materialId || !input.userId) throw new Error('Empresa, obra, material e usuário são obrigatórios.');
  if (!Number.isSafeInteger(input.countedQuantity) || input.countedQuantity < 0 || input.countedQuantity > 999999) throw new Error('A contagem física deve ser um inteiro entre 0 e 999999.');
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) throw new Error('Informe o motivo da contagem entre 5 e 300 caracteres.');
  const stockId = inventoryStockId(input.obraId, input.materialId);
  const stockRef = doc(db, 'inventoryStock', stockId);
  const countRef = doc(collection(db, 'inventoryCounts'));
  const movementRef = doc(collection(db, 'stockMovements'));
  const now = new Date().toISOString();
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(stockRef);
    if (!snapshot.exists()) throw new Error('Não existe saldo cadastrado para este material nesta obra.');
    const stock = snapshot.data() as InventoryStock;
    if (stock.companyId !== input.companyId || stock.obraId !== input.obraId || stock.materialId !== input.materialId) throw new Error('O saldo não corresponde à empresa, obra e material selecionados.');
    const before = stock.quantity;
    const difference = input.countedQuantity - before;
    transaction.set(countRef, {
      id: countRef.id, companyId: input.companyId, obraId: input.obraId, obraName: input.obraName,
      stockId, materialId: input.materialId, materialDescription: input.materialDescription, ca: input.ca,
      unit: stock.unit, systemQuantity: before, countedQuantity: input.countedQuantity,
      difference, reason, createdAt: now, createdBy: input.userId,
    });
    if (difference !== 0) {
      transaction.update(stockRef, { quantity: input.countedQuantity, lowStockAlertSent: false, updatedAt: now });
      transaction.set(movementRef, {
        id: movementRef.id, companyId: input.companyId, obraId: input.obraId, obraName: input.obraName,
        materialId: input.materialId, materialDescription: input.materialDescription, type: 'ADJUSTMENT',
        quantity: difference, balanceBefore: before, balanceAfter: input.countedQuantity,
        notes: `Inventário físico ${countRef.id}: ${reason}`, createdAt: now, createdBy: input.userId,
      });
    }
    return { countId: countRef.id, movementId: difference === 0 ? null : movementRef.id, systemQuantity: before, countedQuantity: input.countedQuantity, difference };
  });
}
