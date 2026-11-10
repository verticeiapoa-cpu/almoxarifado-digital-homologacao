import { collection, doc, runTransaction, type Firestore } from 'firebase/firestore';
import type { InventoryStock } from '../types';
import { inventoryStockId } from './stage2Operations';

export type ReturnDestination = 'AVAILABLE' | 'QUARANTINE' | 'DISCARDED';

export interface ReturnStockInput {
  companyId: string;
  obraId: string;
  obraName: string;
  materialId: string;
  materialDescription: string;
  ca: string;
  quantity: number;
  unit: string;
  minimumStock: number;
  condition: 'GOOD' | 'DAMAGED' | 'UNSAFE';
  destination: ReturnDestination;
  reason: string;
  employeeId?: string;
  employeeName?: string;
  userId: string;
}

/**
 * Records an auditable return. Only items explicitly inspected as GOOD may
 * return to available stock; quarantine and disposal never increase that balance.
 * Admin-only until a dedicated return permission is introduced.
 */
export async function registerStockReturn(db: Firestore, input: ReturnStockInput) {
  if (!input.companyId || !input.obraId || !input.materialId || !input.userId) {
    throw new Error('Empresa, obra, material e usuário são obrigatórios.');
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > 999999) {
    throw new Error('A quantidade devolvida deve ser um inteiro entre 1 e 999999.');
  }
  if (!['GOOD', 'DAMAGED', 'UNSAFE'].includes(input.condition)) throw new Error('Condição do item inválida.');
  if (!['AVAILABLE', 'QUARANTINE', 'DISCARDED'].includes(input.destination)) throw new Error('Destino da devolução inválido.');
  if (input.destination === 'AVAILABLE' && input.condition !== 'GOOD') {
    throw new Error('Somente itens em boas condições podem retornar ao estoque disponível.');
  }
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) throw new Error('Informe um motivo entre 5 e 300 caracteres.');

  const stockId = inventoryStockId(input.obraId, input.materialId);
  const stockRef = doc(db, 'inventoryStock', stockId);
  const returnRef = doc(collection(db, 'stockReturns'));
  const movementRef = doc(collection(db, 'stockMovements'));
  const now = new Date().toISOString();

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(stockRef);
    const previous = snapshot.exists() ? snapshot.data() as InventoryStock : undefined;
    if (previous && (previous.companyId !== input.companyId || previous.obraId !== input.obraId || previous.materialId !== input.materialId)) {
      throw new Error('O saldo não corresponde à empresa, obra e material selecionados.');
    }
    const before = previous?.quantity ?? 0;
    const increasesAvailable = input.destination === 'AVAILABLE';
    if (increasesAvailable && !snapshot.exists()) throw new Error('Cadastre o saldo do material antes de aceitar a devolução.');
    const after = increasesAvailable ? before + input.quantity : before;
    if (!Number.isSafeInteger(after) || after > 999999) throw new Error('O saldo resultante ultrapassa o limite permitido.');

    const returnRecord = {
      id: returnRef.id, companyId: input.companyId, obraId: input.obraId,
      obraName: input.obraName, materialId: input.materialId,
      materialDescription: input.materialDescription, ca: input.ca,
      quantity: input.quantity, unit: input.unit, condition: input.condition,
      destination: input.destination, reason,
      employeeId: (input.employeeId ?? '').trim().slice(0, 128),
      employeeName: (input.employeeName ?? '').trim().slice(0, 100),
      stockId, balanceBefore: before, balanceAfter: after,
      createdAt: now, createdBy: input.userId,
    };

    if (increasesAvailable) {
      transaction.update(stockRef, { quantity: after, lowStockAlertSent: false, updatedAt: now });
      transaction.set(movementRef, {
        id: movementRef.id, companyId: input.companyId, obraId: input.obraId,
        obraName: input.obraName, materialId: input.materialId,
        materialDescription: input.materialDescription, type: 'RETURN',
        quantity: input.quantity, balanceBefore: before, balanceAfter: after,
        notes: `Devolução ${returnRef.id}: ${reason}`, createdAt: now, createdBy: input.userId,
      });
    }
    transaction.set(returnRef, returnRecord);
    return { returnId: returnRef.id, movementId: increasesAvailable ? movementRef.id : null, destination: input.destination, balance: after };
  });
}
