import { collection, doc, runTransaction, type Firestore } from 'firebase/firestore';
import type { InventoryStock, StockMovement } from '../types';

export type ReturnCondition = 'AVAILABLE' | 'QUARANTINE' | 'DISPOSAL';

function quantityIsValid(value: number, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 999999) {
    throw new Error(allowZero ? 'Informe um inteiro entre 0 e 999999.' : 'Informe um inteiro entre 1 e 999999.');
  }
}
function textIsValid(value: string, label: string, max = 300) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${label}: campo obrigatório (máximo de ${max} caracteres).`);
  return normalized;
}
function readStock(data: Record<string, unknown> | undefined, id: string): InventoryStock {
  if (!data || data.id !== id || !Number.isSafeInteger(data.quantity) || Number(data.quantity) < 0) {
    throw new Error('O saldo selecionado não existe ou está inconsistente. Atualize a tela.');
  }
  return data as unknown as InventoryStock;
}
function assertStock(stock: InventoryStock, companyId: string) {
  if (stock.companyId !== companyId) throw new Error('O saldo não pertence à empresa selecionada.');
}
function makeMovement(input: {
  id: string; stock: InventoryStock; type: StockMovement['type']; quantity: number;
  before: number; after: number; userId: string; createdAt: string;
  receiptId?: string; transferId?: string; returnId?: string; inventoryCountId?: string; notes?: string;
}): StockMovement {
  return {
    id: input.id, companyId: input.stock.companyId, obraId: input.stock.obraId, obraName: input.stock.obraName,
    materialId: input.stock.materialId, materialDescription: input.stock.materialDescription,
    type: input.type, quantity: input.quantity, balanceBefore: input.before, balanceAfter: input.after,
    createdAt: input.createdAt, createdBy: input.userId,
    ...(input.receiptId ? { receiptId: input.receiptId } : {}),
    ...(input.transferId ? { transferId: input.transferId } : {}),
    ...(input.returnId ? { returnId: input.returnId } : {}),
    ...(input.inventoryCountId ? { inventoryCountId: input.inventoryCountId } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

export async function recordReceipt(db: Firestore, input: {
  stock: InventoryStock; companyId: string; userId: string; quantity: number;
  supplier: string; invoiceNumber: string; lotCode: string; expiresAt: string; notes: string;
}) {
  quantityIsValid(input.quantity);
  const supplier = textIsValid(input.supplier, 'Fornecedor', 160);
  const stockRef = doc(db, 'inventoryStock', input.stock.id);
  const receiptRef = doc(collection(db, 'receipts'));
  const movementRef = doc(collection(db, 'stockMovements'));
  const now = new Date().toISOString();
  await runTransaction(db, async tx => {
    const snap = await tx.get(stockRef);
    const stock = readStock(snap.exists() ? snap.data() : undefined, input.stock.id);
    assertStock(stock, input.companyId);
    const after = stock.quantity + input.quantity;
    if (after > 999999) throw new Error('O recebimento ultrapassa o limite de saldo permitido.');
    const record = {
      id: receiptRef.id, companyId: stock.companyId, obraId: stock.obraId, obraName: stock.obraName,
      stockId: stock.id, materialId: stock.materialId, materialDescription: stock.materialDescription, ca: stock.ca,
      quantity: input.quantity, supplier, invoiceNumber: input.invoiceNumber.trim().slice(0, 80),
      lotCode: input.lotCode.trim().slice(0, 80), expiresAt: input.expiresAt, notes: input.notes.trim().slice(0, 300),
      movementId: movementRef.id, status: 'COMPLETED', createdAt: now, createdBy: input.userId,
    };
    tx.update(stockRef, { quantity: after, lowStockAlertSent: false, updatedAt: now, lastMovementId: movementRef.id });
    tx.set(receiptRef, record);
    tx.set(movementRef, makeMovement({
      id: movementRef.id, stock, type: 'ENTRY', quantity: input.quantity, before: stock.quantity, after,
      userId: input.userId, createdAt: now, receiptId: receiptRef.id, notes: record.notes,
    }));
  });
  return receiptRef.id;
}

export async function transferStock(db: Firestore, input: {
  source: InventoryStock; destination: InventoryStock; companyId: string; userId: string; quantity: number; notes: string;
}) {
  quantityIsValid(input.quantity);
  const notes = textIsValid(input.notes, 'Motivo da transferência');
  if (input.source.id === input.destination.id || input.source.obraId === input.destination.obraId) {
    throw new Error('Origem e destino precisam ser obras diferentes.');
  }
  if (input.source.materialId !== input.destination.materialId || input.source.unit !== input.destination.unit) {
    throw new Error('A transferência precisa manter o mesmo item e unidade.');
  }
  const sourceRef = doc(db, 'inventoryStock', input.source.id);
  const destinationRef = doc(db, 'inventoryStock', input.destination.id);
  const eventRef = doc(collection(db, 'transfers'));
  const outRef = doc(collection(db, 'stockMovements'));
  const inRef = doc(collection(db, 'stockMovements'));
  const now = new Date().toISOString();
  await runTransaction(db, async tx => {
    const [sourceSnap, destinationSnap] = await Promise.all([tx.get(sourceRef), tx.get(destinationRef)]);
    const source = readStock(sourceSnap.exists() ? sourceSnap.data() : undefined, input.source.id);
    const destination = readStock(destinationSnap.exists() ? destinationSnap.data() : undefined, input.destination.id);
    assertStock(source, input.companyId);
    assertStock(destination, input.companyId);
    if (source.materialId !== destination.materialId || source.unit !== destination.unit) throw new Error('Os saldos não representam o mesmo item e unidade.');
    if (source.quantity < input.quantity) throw new Error('Saldo insuficiente na obra de origem.');
    if (destination.quantity + input.quantity > 999999) throw new Error('O destino ultrapassa o limite de saldo permitido.');
    const sourceAfter = source.quantity - input.quantity;
    const destinationAfter = destination.quantity + input.quantity;
    tx.update(sourceRef, { quantity: sourceAfter, lowStockAlertSent: false, updatedAt: now, lastMovementId: outRef.id });
    tx.update(destinationRef, { quantity: destinationAfter, lowStockAlertSent: false, updatedAt: now, lastMovementId: inRef.id });
    tx.set(eventRef, {
      id: eventRef.id, companyId: input.companyId,
      sourceObraId: source.obraId, sourceObraName: source.obraName,
      destinationObraId: destination.obraId, destinationObraName: destination.obraName,
      sourceStockId: source.id, destinationStockId: destination.id,
      materialId: source.materialId, materialDescription: source.materialDescription, ca: source.ca,
      unit: source.unit, quantity: input.quantity, notes,
      sourceMovementId: outRef.id, destinationMovementId: inRef.id,
      status: 'COMPLETED', createdAt: now, createdBy: input.userId,
    });
    tx.set(outRef, makeMovement({
      id: outRef.id, stock: source, type: 'TRANSFER', quantity: -input.quantity,
      before: source.quantity, after: sourceAfter, userId: input.userId, createdAt: now, transferId: eventRef.id, notes,
    }));
    tx.set(inRef, makeMovement({
      id: inRef.id, stock: destination, type: 'TRANSFER', quantity: input.quantity,
      before: destination.quantity, after: destinationAfter, userId: input.userId, createdAt: now, transferId: eventRef.id, notes,
    }));
  });
  return eventRef.id;
}

export async function recordReturn(db: Firestore, input: {
  stock: InventoryStock; companyId: string; userId: string; quantity: number; condition: ReturnCondition;
  employeeName: string; reference: string; notes: string;
}) {
  quantityIsValid(input.quantity);
  const notes = textIsValid(input.notes, 'Condição e motivo da devolução');
  const stockRef = doc(db, 'inventoryStock', input.stock.id);
  const eventRef = doc(collection(db, 'returns'));
  const movementRef = input.condition === 'AVAILABLE' ? doc(collection(db, 'stockMovements')) : null;
  const quarantineRef = input.condition === 'AVAILABLE' ? null : doc(db, 'quarantineStock', eventRef.id);
  const now = new Date().toISOString();
  await runTransaction(db, async tx => {
    const snap = await tx.get(stockRef);
    const stock = readStock(snap.exists() ? snap.data() : undefined, input.stock.id);
    assertStock(stock, input.companyId);
    if (input.condition === 'AVAILABLE' && stock.quantity + input.quantity > 999999) throw new Error('A devolução ultrapassa o limite de saldo permitido.');
    const record = {
      id: eventRef.id, companyId: stock.companyId, obraId: stock.obraId, obraName: stock.obraName,
      stockId: stock.id, materialId: stock.materialId, materialDescription: stock.materialDescription,
      ca: stock.ca, unit: stock.unit, quantity: input.quantity, condition: input.condition,
      employeeName: input.employeeName.trim().slice(0, 120), reference: input.reference.trim().slice(0, 120),
      notes, status: 'COMPLETED', createdAt: now, createdBy: input.userId,
      ...(movementRef ? { movementId: movementRef.id } : {}),
    };
    tx.set(eventRef, record);
    if (input.condition === 'AVAILABLE' && movementRef) {
      const after = stock.quantity + input.quantity;
      tx.update(stockRef, { quantity: after, lowStockAlertSent: false, updatedAt: now, lastMovementId: movementRef.id });
      tx.set(movementRef, makeMovement({
        id: movementRef.id, stock, type: 'RETURN', quantity: input.quantity,
        before: stock.quantity, after, userId: input.userId, createdAt: now, returnId: eventRef.id, notes,
      }));
    } else if (quarantineRef) {
      tx.set(quarantineRef, {
        id: quarantineRef.id, returnId: eventRef.id, companyId: stock.companyId,
        obraId: stock.obraId, obraName: stock.obraName, stockId: stock.id,
        materialId: stock.materialId, materialDescription: stock.materialDescription,
        ca: stock.ca, unit: stock.unit, quantity: input.quantity, condition: input.condition,
        employeeName: record.employeeName, reference: record.reference, notes,
        status: input.condition === 'DISPOSAL' ? 'PENDING_DISPOSAL' : 'QUARANTINED',
        createdAt: now, createdBy: input.userId,
      });
    }
  });
  return eventRef.id;
}

export async function confirmInventoryCount(db: Firestore, input: {
  stock: InventoryStock; companyId: string; userId: string; countedQuantity: number; expectedQuantity: number; reason: string;
}) {
  quantityIsValid(input.countedQuantity, true);
  const reason = textIsValid(input.reason, 'Justificativa do ajuste');
  const stockRef = doc(db, 'inventoryStock', input.stock.id);
  const eventRef = doc(collection(db, 'inventoryCounts'));
  const movementRef = doc(collection(db, 'stockMovements'));
  const now = new Date().toISOString();
  await runTransaction(db, async tx => {
    const snap = await tx.get(stockRef);
    const stock = readStock(snap.exists() ? snap.data() : undefined, input.stock.id);
    assertStock(stock, input.companyId);
    if (stock.quantity !== input.expectedQuantity) throw new Error('O saldo mudou desde a abertura da contagem. Atualize e faça nova conferência.');
    const difference = input.countedQuantity - stock.quantity;
    const movementId = difference === 0 ? '' : movementRef.id;
    tx.set(eventRef, {
      id: eventRef.id, companyId: stock.companyId, obraId: stock.obraId, obraName: stock.obraName,
      stockId: stock.id, materialId: stock.materialId, materialDescription: stock.materialDescription,
      ca: stock.ca, unit: stock.unit, beforeQuantity: stock.quantity, countedQuantity: input.countedQuantity,
      difference, confirmedQuantity: input.countedQuantity, reason, movementId, createdAt: now, createdBy: input.userId,
    });
    if (difference !== 0) {
      tx.update(stockRef, { quantity: input.countedQuantity, lowStockAlertSent: false, updatedAt: now, lastMovementId: movementId });
      tx.set(movementRef, makeMovement({
        id: movementRef.id, stock, type: 'ADJUSTMENT', quantity: difference, before: stock.quantity,
        after: input.countedQuantity, userId: input.userId, createdAt: now, inventoryCountId: eventRef.id, notes: reason,
      }));
    }
  });
  return eventRef.id;
}
