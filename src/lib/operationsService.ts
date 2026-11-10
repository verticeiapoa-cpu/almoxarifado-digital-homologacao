// Etapa 2 — execução transacional das operações planejadas em operations.ts.
// Leitura e escrita acontecem na MESMA transação: se o saldo mudar no meio do caminho, o Firestore repete
// a transação e o planejamento é refeito com o saldo atual (ou falha com mensagem clara).
import { collection, doc, getDocsFromServer, query, runTransaction, where, type Firestore } from 'firebase/firestore';
import type { Delivery, InventoryCount, InventoryCountItem, InventoryStock, ReturnLedger, ReturnRecord, Transfer } from '../types';
import {
  planCountAdjustment, planCountClose, planCountHeader, planCountItem, planReceipt, planReturn, planReturnInspection,
  planTransferCancel, planTransferConfirm, planTransferRequest,
  type Actor, type PlannedWrite, type ReceiptInput, type ReturnInput, type TransferRequestInput,
} from './operations';

export type DocMap = Map<string, Record<string, unknown> | undefined>;

export function friendlyOperationError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === 'permission-denied') return 'Operação não autorizada. Confira seu acesso à obra, a permissão de ajuste e se o saldo não mudou. Atualize a tela e tente novamente.';
  if (['aborted', 'failed-precondition', 'already-exists'].includes(code)) return 'Outra pessoa alterou estes dados ao mesmo tempo ou a operação já foi registrada. Atualize a tela e confira antes de repetir.';
  if (['unavailable', 'deadline-exceeded'].includes(code)) return 'Sem conexão com o servidor. Verifique a internet e tente novamente; confira o histórico antes de repetir para não duplicar.';
  return error instanceof Error && error.message ? error.message : 'Não foi possível concluir a operação.';
}

export async function runOperation(db: Firestore, readPaths: string[], build: (docs: DocMap) => PlannedWrite[]) {
  return runTransaction(db, async transaction => {
    const docs: DocMap = new Map();
    for (const path of readPaths) {
      try {
        const snapshot = await transaction.get(doc(db, path));
        docs.set(path, snapshot.exists() ? snapshot.data() as Record<string, unknown> : undefined);
      } catch (error) {
        // Regras baseadas em resource.data negam leitura de documento ausente; tratamos como "não existe".
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'permission-denied') docs.set(path, undefined);
        else throw error;
      }
    }
    const writes = build(docs);
    for (const write of writes) {
      if (write.kind === 'set') transaction.set(doc(db, write.path), write.data);
      else transaction.update(doc(db, write.path), write.data);
    }
    return writes;
  });
}

const stockPath = (obraId: string, materialId: string) => `inventoryStock/${obraId}__${materialId}`;
const as = <T,>(value: Record<string, unknown> | undefined) => value as T | undefined;

export const registerReceipt = (db: Firestore, materialId: string, input: ReceiptInput, actor: Actor) =>
  runOperation(db, [stockPath(input.obraId, materialId)], docs => planReceipt(input, as<InventoryStock>(docs.get(stockPath(input.obraId, materialId))), actor, new Date().toISOString()).writes);

export const requestTransfer = (db: Firestore, input: TransferRequestInput, accessibleObraIds: string[], isAdmin: boolean, actor: Actor) =>
  runOperation(db, [], () => planTransferRequest(input, accessibleObraIds, isAdmin, actor, new Date().toISOString()).writes);

export const confirmTransfer = (db: Firestore, transferId: string, fromObraId: string, toObraId: string, materialId: string, accessibleObraIds: string[], isAdmin: boolean, actor: Actor) => {
  const paths = [`transfers/${transferId}`, stockPath(fromObraId, materialId), stockPath(toObraId, materialId)];
  return runOperation(db, paths, docs => {
    const transfer = as<Transfer>(docs.get(paths[0]));
    if (!transfer) throw new Error('Transferência não encontrada.');
    return planTransferConfirm(transfer, as<InventoryStock>(docs.get(paths[1])), as<InventoryStock>(docs.get(paths[2])), accessibleObraIds, isAdmin, actor, new Date().toISOString()).writes;
  });
};

export const cancelTransfer = (db: Firestore, transferId: string, reason: string, accessibleObraIds: string[], isAdmin: boolean, actor: Actor) =>
  runOperation(db, [`transfers/${transferId}`], docs => {
    const transfer = as<Transfer>(docs.get(`transfers/${transferId}`));
    if (!transfer) throw new Error('Transferência não encontrada.');
    return planTransferCancel(transfer, reason, accessibleObraIds, isAdmin, actor, new Date().toISOString()).writes;
  });

// Entrega e controle de devolvido são lidos dentro da transação para impedir devolução acima do entregue.
export async function loadReturnLedger(db: Firestore, companyId: string, obraId: string, deliveryId: string, materialId: string) {
  const result = await getDocsFromServer(query(collection(db, 'returnLedger'), where('companyId', '==', companyId), where('obraId', '==', obraId), where('deliveryId', '==', deliveryId)));
  return result.docs.find(snapshot => snapshot.id === `${deliveryId}__${materialId}`)?.data() as ReturnLedger | undefined;
}

export async function registerReturn(db: Firestore, input: Omit<ReturnInput, 'delivery'> & { deliveryId?: string }, actor: Actor) {
  const ledgerPath = input.deliveryId ? `returnLedger/${input.deliveryId}__${input.materialId}` : '';
  const ledgerExists = input.deliveryId ? Boolean(await loadReturnLedger(db, actor.companyId, input.obraId, input.deliveryId, input.materialId)) : false;
  const paths = [stockPath(input.obraId, input.materialId), ...(input.deliveryId ? [`deliveries/${input.deliveryId}`] : []), ...(ledgerExists ? [ledgerPath] : [])];
  return runOperation(db, paths, docs => {
    const delivery = input.deliveryId ? as<Delivery>(docs.get(`deliveries/${input.deliveryId}`)) : undefined;
    if (input.deliveryId && !delivery) throw new Error('Entrega não encontrada.');
    return planReturn({ ...input, delivery }, as<InventoryStock>(docs.get(paths[0])), ledgerExists ? as<ReturnLedger>(docs.get(ledgerPath)) : undefined, actor, new Date().toISOString()).writes;
  });
}

export const inspectReturn = (db: Firestore, record: ReturnRecord, resolution: 'BOM_ESTADO' | 'DANIFICADO' | 'INSERVIVEL', notes: string | undefined, actor: Actor) =>
  runOperation(db, [`returns/${record.id}`, stockPath(record.obraId, record.materialId)], docs => {
    const current = as<ReturnRecord>(docs.get(`returns/${record.id}`));
    if (!current) throw new Error('Devolução não encontrada.');
    return planReturnInspection(current, resolution, notes, as<InventoryStock>(docs.get(stockPath(record.obraId, record.materialId))), actor, new Date().toISOString()).writes;
  });

export const openCount = (db: Firestore, id: string, obraId: string, obraName: string, countedAt: string, actor: Actor) =>
  runOperation(db, [], () => planCountHeader(id, obraId, obraName, countedAt, actor, new Date().toISOString()).writes);

export const recordCountItem = (db: Firestore, count: InventoryCount, materialId: string, countedQty: number, justification: string | undefined, actor: Actor) =>
  runOperation(db, [stockPath(count.obraId, materialId), `inventoryCounts/${count.id}`], docs => {
    const header = as<InventoryCount>(docs.get(`inventoryCounts/${count.id}`)) ?? count;
    return planCountItem(header, as<InventoryStock>(docs.get(stockPath(count.obraId, materialId))), countedQty, justification, actor, new Date().toISOString()).writes;
  });

export const adjustCountItem = (db: Firestore, item: InventoryCountItem, canAdjust: boolean, obraName: string, actor: Actor) =>
  runOperation(db, [`inventoryCountItems/${item.id}`, stockPath(item.obraId, item.materialId)], docs => {
    const current = as<InventoryCountItem>(docs.get(`inventoryCountItems/${item.id}`));
    if (!current) throw new Error('Item de contagem não encontrado.');
    return planCountAdjustment(current, as<InventoryStock>(docs.get(stockPath(item.obraId, item.materialId))), canAdjust, obraName, actor, new Date().toISOString()).writes;
  });

export const closeCount = (db: Firestore, count: InventoryCount, status: 'CONFIRMADA' | 'CANCELADA', pendingItems: number, canAdjust: boolean, reason: string | undefined, actor: Actor) =>
  runOperation(db, [`inventoryCounts/${count.id}`], docs => {
    const current = as<InventoryCount>(docs.get(`inventoryCounts/${count.id}`)) ?? count;
    return planCountClose(current, status, pendingItems, canAdjust, reason, actor, new Date().toISOString()).writes;
  });

export const newOperationId = (db: Firestore, collectionName: string) => doc(collection(db, collectionName)).id;
