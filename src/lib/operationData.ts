// Leitura (somente leitura) das operações da Etapa 2 para relatórios. Uma consulta por obra e por campo,
// como exigem as regras do Firestore; o filtro de escopo/empresa é reaplicado em operationReports.ts.
import { collection, getDocs, limit, query, where, type Firestore } from 'firebase/firestore';
import type { InventoryCountItem, Receipt, ReturnRecord, Transfer } from '../types';
import type { DataScope } from './reports';

const MAX_PER_QUERY = 1000;

async function byObra<T extends { id: string }>(db: Firestore, scope: DataScope, selection: string, name: string, fields: string[]): Promise<{ rows: T[]; truncated: boolean }> {
  const obraIds = selection === 'ALL' ? scope.obraIds : scope.obraIds.filter(id => id === selection);
  if (selection !== 'ALL' && obraIds.length === 0) throw new Error('A obra selecionada está fora do seu acesso.');
  const snaps = await Promise.all(obraIds.flatMap(obraId => fields.map(field =>
    getDocs(query(collection(db, name), where('companyId', '==', scope.companyId), where(field, '==', obraId), limit(MAX_PER_QUERY))))));
  const map = new Map<string, T>();
  snaps.forEach(snap => snap.docs.forEach(d => map.set(d.id, { ...(d.data() as T), id: d.id })));
  return { rows: [...map.values()], truncated: snaps.some(snap => snap.size >= MAX_PER_QUERY) };
}

export const fetchReceipts = (db: Firestore, scope: DataScope, selection: string) => byObra<Receipt>(db, scope, selection, 'receipts', ['obraId']);
export const fetchTransfers = (db: Firestore, scope: DataScope, selection: string) => byObra<Transfer>(db, scope, selection, 'transfers', ['fromObraId', 'toObraId']);
export const fetchReturns = (db: Firestore, scope: DataScope, selection: string) => byObra<ReturnRecord>(db, scope, selection, 'returns', ['obraId']);
export const fetchCountItems = (db: Firestore, scope: DataScope, selection: string) => byObra<InventoryCountItem>(db, scope, selection, 'inventoryCountItems', ['obraId']);
