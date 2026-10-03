import { collection, doc, getDocsFromServer, query, where, runTransaction, type Firestore } from 'firebase/firestore';
import type { InventoryStock, Material, Obra, StockMovement } from '../types';
import { commitDocuments, type ConditionalWrite } from './firestoreCommit';

export const stockDocumentId = (obraId: string, materialId: string) => `${obraId}__${materialId}`;

export async function loadMaterialStock(db: Firestore, companyId: string, obraId: string, materialId: string) {
  // A company-scoped query may legitimately return no documents. A direct get
  // on an absent stock is denied by resource.data-based rules.
  const result = await getDocsFromServer(query(collection(db, 'inventoryStock'),
    where('companyId', '==', companyId), where('obraId', '==', obraId), where('materialId', '==', materialId)));
  return result.docs.find(snapshot => snapshot.id === stockDocumentId(obraId, materialId))?.data() as InventoryStock | undefined;
}

export function parseStockCount(value: string, label: string) {
  const normalized = value.trim();
  const count = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(count) || count > 999999) {
    throw new Error(`${label}: informe um número inteiro entre 0 e 999999.`);
  }
  return count;
}

export interface SaveMaterialStockInput {
  material: Material;
  isNewMaterial: boolean;
  obra: Obra;
  companyId: string;
  userId: string;
  quantity: number;
  minimumStock: number;
  unit: string;
  // null means the form was opened before this obra had a stock document.
  expectedQuantity: number | null;
}

export function prepareStockChange(input: SaveMaterialStockInput, existing: InventoryStock | undefined, now: string, movementId: string) {
  const { material, obra, companyId, userId, quantity, minimumStock, unit } = input;
  if (![quantity, minimumStock].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 999999)) {
    throw new Error('Saldo e estoque mínimo devem ser inteiros entre 0 e 999999.');
  }
  if ((existing?.quantity ?? null) !== input.expectedQuantity) {
    throw new Error('O saldo foi alterado enquanto você editava. Reabra a edição para conferir o saldo atualizado antes de salvar.');
  }
  if (existing && (existing.companyId !== companyId || existing.obraId !== obra.id || existing.materialId !== material.id)) {
    throw new Error('O saldo não pertence ao EPI e à obra selecionados.');
  }
  const stock: InventoryStock = {
    id: stockDocumentId(obra.id, material.id), companyId, obraId: obra.id, obraName: obra.name,
    materialId: material.id, materialDescription: material.description, ca: material.ca,
    quantity, minimumStock, unit,
    lowStockAlertSent: minimumStock <= 0 || quantity > minimumStock ? false : Boolean(existing?.lowStockAlertSent),
    ...(existing?.lastLowStockAlertAt ? { lastLowStockAlertAt: existing.lastLowStockAlertAt } : {}),
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
  const before = existing?.quantity ?? 0;
  const difference = quantity - before;
  const movement: StockMovement | undefined = difference === 0 ? undefined : {
    id: movementId, companyId, obraId: obra.id, obraName: obra.name,
    materialId: material.id, materialDescription: material.description,
    type: difference > 0 ? 'ENTRY' : 'ADJUSTMENT', quantity: difference,
    balanceBefore: before, balanceAfter: quantity, createdAt: now, createdBy: userId,
  };
  return { stock, movement };
}

export async function saveMaterialStock(db: Firestore, input: SaveMaterialStockInput): Promise<InventoryStock> {
  const materialRef = doc(db, 'materials', input.material.id);
  const stockRef = doc(db, 'inventoryStock', stockDocumentId(input.obra.id, input.material.id));
  const movementRef = doc(collection(db, 'stockMovements'));
  const current = await loadMaterialStock(db, input.companyId, input.obra.id, input.material.id);
  if (!current) {
    const now = new Date().toISOString();
    const { stock, movement } = prepareStockChange(input, undefined, now, movementRef.id);
    const writes: ConditionalWrite[] = [
      input.isNewMaterial ? {
        path: materialRef.path, exists: false,
        data: { ...input.material, companyId: input.companyId, createdAt: now, updatedAt: now },
      } : {
        path: materialRef.path, exists: true,
        data: { description: input.material.description, ca: input.material.ca, updatedAt: now },
        updateFields: ['description', 'ca', 'updatedAt'],
      },
      { path: stockRef.path, exists: false, data: { ...stock } },
    ];
    if (movement) writes.push({ path: movementRef.path, exists: false, data: { ...movement } });
    try {
      await commitDocuments(db, writes, input.userId);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && ['already-exists', 'failed-precondition'].includes(String(error.code))) {
        throw new Error('O saldo já foi cadastrado durante esta tentativa. Reabra a edição para conferir os valores atuais.');
      }
      throw error;
    }
    return stock;
  }
  return runTransaction(db, async transaction => {
    // The query confirmed this document exists; transactional rereads prevent a
    // concurrent delivery from being overwritten by a stale balance in the form.
    const snapshot = await transaction.get(stockRef);
    const existing = snapshot.exists() ? snapshot.data() as InventoryStock : undefined;
    const now = new Date().toISOString();
    const { stock, movement } = prepareStockChange(input, existing, now, movementRef.id);
    if (input.isNewMaterial) {
      transaction.set(materialRef, { ...input.material, companyId: input.companyId, createdAt: now, updatedAt: now });
    } else {
      transaction.update(materialRef, { description: input.material.description, ca: input.material.ca, updatedAt: now });
    }
    // Either all three writes commit or none do. Do not leave orphan EPIs or
    // silently lose their audit movement when a stock operation fails.
    transaction.set(stockRef, stock);
    if (movement) transaction.set(movementRef, movement);
    return stock;
  });
}
