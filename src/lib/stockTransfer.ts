import { collection, doc, runTransaction, type Firestore } from 'firebase/firestore';
import type { InventoryStock } from '../types';
import { inventoryStockId } from './stage2Operations';

export interface TransferStockInput {
  companyId: string;
  sourceObraId: string;
  sourceObraName: string;
  destinationObraId: string;
  destinationObraName: string;
  materialId: string;
  materialDescription: string;
  ca: string;
  quantity: number;
  unit: string;
  minimumStock: number;
  reason: string;
  userId: string;
}

/**
 * Transfers stock between two worksites in one transaction.
 * The operation is intentionally admin-only until the product has a
 * dedicated permission for transfers across both assigned worksites.
 */
export async function transferStock(db: Firestore, input: TransferStockInput) {
  if (!input.companyId || !input.userId || !input.materialId) throw new Error('Empresa, usuário e material são obrigatórios.');
  if (!input.sourceObraId || !input.destinationObraId || input.sourceObraId === input.destinationObraId) {
    throw new Error('Selecione duas obras diferentes.');
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > 999999) {
    throw new Error('A quantidade deve ser um inteiro entre 1 e 999999.');
  }
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) throw new Error('Informe um motivo entre 5 e 300 caracteres.');

  const sourceId = inventoryStockId(input.sourceObraId, input.materialId);
  const destinationId = inventoryStockId(input.destinationObraId, input.materialId);
  const sourceRef = doc(db, 'inventoryStock', sourceId);
  const destinationRef = doc(db, 'inventoryStock', destinationId);
  const transferRef = doc(collection(db, 'stockTransfers'));
  const sourceMovementRef = doc(collection(db, 'stockMovements'));
  const destinationMovementRef = doc(collection(db, 'stockMovements'));
  const now = new Date().toISOString();

  return runTransaction(db, async transaction => {
    const [sourceSnapshot, destinationSnapshot] = await Promise.all([
      transaction.get(sourceRef), transaction.get(destinationRef),
    ]);
    if (!sourceSnapshot.exists()) throw new Error('Não existe saldo cadastrado na obra de origem.');
    const source = sourceSnapshot.data() as InventoryStock;
    const destination = destinationSnapshot.exists() ? destinationSnapshot.data() as InventoryStock : undefined;

    for (const stock of [source, destination].filter(Boolean) as InventoryStock[]) {
      if (stock.companyId !== input.companyId || stock.materialId !== input.materialId ||
        (stock === source && stock.obraId !== input.sourceObraId) ||
        (stock === destination && stock.obraId !== input.destinationObraId)) {
        throw new Error('O estoque não pertence à empresa ou ao material selecionado.');
      }
    }
    if (source.quantity < input.quantity) throw new Error('Saldo insuficiente na obra de origem.');

    const sourceAfter = source.quantity - input.quantity;
    const destinationBefore = destination?.quantity ?? 0;
    const destinationAfter = destinationBefore + input.quantity;
    if (!Number.isSafeInteger(destinationAfter) || destinationAfter > 999999) throw new Error('Saldo de destino ultrapassa o limite permitido.');

    const destinationStock: InventoryStock = {
      id: destinationId, companyId: input.companyId, obraId: input.destinationObraId,
      obraName: input.destinationObraName, materialId: input.materialId,
      materialDescription: input.materialDescription, ca: input.ca,
      quantity: destinationAfter, minimumStock: destination?.minimumStock ?? input.minimumStock,
      unit: destination?.unit ?? input.unit, lowStockAlertSent: false,
      createdAt: destination?.createdAt ?? now, updatedAt: now,
    };
    const transfer = {
      id: transferRef.id, companyId: input.companyId,
      sourceObraId: input.sourceObraId, sourceObraName: input.sourceObraName,
      destinationObraId: input.destinationObraId, destinationObraName: input.destinationObraName,
      materialId: input.materialId, materialDescription: input.materialDescription,
      quantity: input.quantity, unit: input.unit, reason,
      sourceStockId: sourceId, destinationStockId: destinationId,
      sourceBalanceBefore: source.quantity, sourceBalanceAfter: sourceAfter,
      destinationBalanceBefore: destinationBefore, destinationBalanceAfter: destinationAfter,
      status: 'COMPLETED', createdAt: now, createdBy: input.userId,
    };
    const baseMovement = {
      companyId: input.companyId, materialId: input.materialId,
      materialDescription: input.materialDescription, type: 'TRANSFER' as const,
      createdAt: now, createdBy: input.userId, notes: `Transferência ${transferRef.id}: ${reason}`,
    };

    transaction.update(sourceRef, { quantity: sourceAfter, lowStockAlertSent: false, updatedAt: now });
    if (destinationSnapshot.exists()) transaction.update(destinationRef, { quantity: destinationAfter, lowStockAlertSent: false, updatedAt: now });
    else transaction.set(destinationRef, destinationStock);
    transaction.set(transferRef, transfer);
    transaction.set(sourceMovementRef, {
      ...baseMovement, id: sourceMovementRef.id, obraId: input.sourceObraId,
      obraName: input.sourceObraName, quantity: -input.quantity,
      balanceBefore: source.quantity, balanceAfter: sourceAfter,
    });
    transaction.set(destinationMovementRef, {
      ...baseMovement, id: destinationMovementRef.id, obraId: input.destinationObraId,
      obraName: input.destinationObraName, quantity: input.quantity,
      balanceBefore: destinationBefore, balanceAfter: destinationAfter,
    });
    return { transferId: transferRef.id, sourceBalance: sourceAfter, destinationBalance: destinationAfter };
  });
}
