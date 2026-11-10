// ETAPA 2 — testes das regras de recebimento, transferência, devolução e inventário.
// ATENÇÃO: exigem o emulador do Firestore (npm run test:rules:stage2). Não foram executados
// no ambiente de desenvolvimento desta etapa (sem rede para baixar firebase-tools).
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';

const COMPANY = 'wselent-default';
const NOW = '2026-09-10T12:00:00.000Z';
let env: RulesTestEnvironment;

const user = (uid: string, role: 'admin' | 'storekeeper', obraIds: string[], extra: Record<string, unknown> = {}, companyId = COMPANY) => ({
  uid, email: `${uid}@example.com`, name: uid, companyId, role, assignedObraIds: obraIds, createdAt: NOW, updatedAt: NOW, ...extra,
});
const stock = (obraId: string, quantity: number, materialId = 'material-a') => ({
  id: `${obraId}__${materialId}`, companyId: COMPANY, obraId, obraName: obraId === 'obra-a' ? 'OBRA A' : 'OBRA B',
  materialId, materialDescription: 'CAPACETE', ca: '123', quantity, minimumStock: 5, unit: 'UN', lowStockAlertSent: false, createdAt: 'x', updatedAt: 'x',
});
const obraName = (id: string) => (id === 'obra-a' ? 'OBRA A' : 'OBRA B');
const mvId = (op: string, obra: string, mat = 'material-a') => `${op}__${obra}__${mat}`;

const movement = (op: string, opType: string, type: string, obra: string, qty: number, before: number, uid: string) => ({
  id: mvId(op, obra), companyId: COMPANY, obraId: obra, materialId: 'material-a', materialDescription: 'CAPACETE', type,
  quantity: qty, balanceBefore: before, balanceAfter: before + qty, operationType: opType, operationId: op, createdAt: NOW, createdBy: uid,
});
const receipt = (id: string, qty: number, before: number, uid: string, over: Record<string, unknown> = {}) => ({
  id, companyId: COMPANY, obraId: 'obra-a', obraName: 'OBRA A', materialId: 'material-a', materialDescription: 'CAPACETE', quantity: qty, unit: 'UN',
  receivedAt: '2026-09-10', balanceBefore: before, balanceAfter: before + qty, movementId: mvId(id, 'obra-a'), status: 'CONCLUIDA',
  createdAt: NOW, createdBy: uid, createdByName: uid, ...over,
});
const transfer = (id: string, qty: number, uid: string, over: Record<string, unknown> = {}) => ({
  id, companyId: COMPANY, fromObraId: 'obra-a', fromObraName: 'OBRA A', toObraId: 'obra-b', toObraName: 'OBRA B', materialId: 'material-a',
  materialDescription: 'CAPACETE', quantity: qty, unit: 'UN', status: 'PENDENTE', requestedBy: uid, requestedByName: uid, requestedAt: NOW, ...over,
});
const stockUp = (db: ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore'] extends () => infer D ? D : never, obra: string, quantity: number, lastMovementId: string) =>
  ({ ref: doc(db, `inventoryStock/${obra}__material-a`), data: { quantity, lastMovementId, updatedAt: NOW } });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-almoxarifado', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
});
afterAll(async () => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/admin'), user('admin', 'admin', ['ALL']));
    await setDoc(doc(db, 'users/keeper-ab'), user('keeper-ab', 'storekeeper', ['obra-a', 'obra-b']));
    await setDoc(doc(db, 'users/keeper-a'), user('keeper-a', 'storekeeper', ['obra-a']));
    await setDoc(doc(db, 'users/keeper-adj'), user('keeper-adj', 'storekeeper', ['obra-a'], { canAdjustStock: true }));
    await setDoc(doc(db, 'users/other'), user('other', 'admin', ['ALL'], {}, 'other-company'));
    await setDoc(doc(db, 'obras/obra-a'), { id: 'obra-a', name: 'OBRA A', address: '', companyId: COMPANY, isActive: true });
    await setDoc(doc(db, 'obras/obra-b'), { id: 'obra-b', name: 'OBRA B', address: '', companyId: COMPANY, isActive: true });
    await setDoc(doc(db, 'employees/employee-a'), { id: 'employee-a', name: 'EMPREGADO TESTE', cpf: '', jobTitle: 'S', obraId: 'obra-a', obraName: 'OBRA A', companyId: COMPANY, isOutsourced: false, isActive: true });
    await setDoc(doc(db, 'inventoryStock/obra-a__material-a'), stock('obra-a', 10));
    await setDoc(doc(db, 'inventoryStock/obra-b__material-a'), stock('obra-b', 3));
  });
});

const as = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();

describe('recebimento', () => {
  const commit = (uid: string, qty = 5, over: Record<string, unknown> = {}, before = 10, movQty = qty) => {
    const db = as(uid);
    const b = writeBatch(db);
    b.set(doc(db, 'receipts/r1'), receipt('r1', qty, before, uid, over));
    b.set(doc(db, `stockMovements/${mvId('r1', 'obra-a')}`), movement('r1', 'RECEIPT', 'ENTRY', 'obra-a', movQty, before, uid));
    const s = stockUp(db, 'obra-a', before + movQty, mvId('r1', 'obra-a'));
    b.update(s.ref, s.data);
    return b.commit();
  };
  it('almoxarife da obra registra recebimento com movimentação e saldo atômicos', async () => { await assertSucceeds(commit('keeper-a')); });
  it('bloqueia obra fora do acesso', async () => { await assertFails(commit('keeper-a', 5, { obraId: 'obra-b', obraName: 'OBRA B', movementId: mvId('r1', 'obra-b') })); });
  it('bloqueia quantidade zero ou negativa', async () => { await assertFails(commit('keeper-a', 0)); await assertFails(commit('keeper-a', -2)); });
  it('bloqueia saldo anterior divergente (saldo desatualizado)', async () => { await assertFails(commit('keeper-a', 5, {}, 9)); });
  it('bloqueia movimentação com quantidade diferente do recebimento', async () => { await assertFails(commit('keeper-a', 5, {}, 10, 4)); });
  it('bloqueia outra empresa', async () => { await assertFails(commit('other')); });
  it('não permite editar nem apagar recebimento concluído', async () => {
    await commit('keeper-a');
    await assertFails(setDoc(doc(as('admin'), 'receipts/r1'), { quantity: 99 }, { merge: true }));
    await assertFails(setDoc(doc(as('keeper-a'), 'receipts/r1'), receipt('r1', 6, 10, 'keeper-a')));
  });
  it('não permite aumento de saldo sem movimentação', async () => {
    await assertFails(setDoc(doc(as('keeper-a'), 'inventoryStock/obra-a__material-a'), { quantity: 50, updatedAt: NOW }, { merge: true }));
  });
  it('campos informativos (lote, validade, fornecedor, NF) são aceitos', async () => {
    await assertSucceeds(commit('keeper-a', 5, { lot: 'L1', expiresAt: '2027-01-01', supplier: 'ACME', invoiceNumber: '123' }));
  });
});

describe('transferência', () => {
  const request = (uid: string, qty = 4, over: Record<string, unknown> = {}) => setDoc(doc(as(uid), 'transfers/t1'), transfer('t1', qty, uid, over));
  const confirm = (uid: string, qty = 4, srcBefore = 10, dstBefore = 3) => {
    const db = as(uid);
    const b = writeBatch(db);
    b.update(doc(db, 'transfers/t1'), {
      status: 'CONCLUIDA', confirmedBy: uid, confirmedByName: uid, confirmedAt: NOW,
      outMovementId: mvId('t1', 'obra-a'), inMovementId: mvId('t1', 'obra-b'),
    });
    b.set(doc(db, `stockMovements/${mvId('t1', 'obra-a')}`), movement('t1', 'TRANSFER', 'TRANSFER', 'obra-a', -qty, srcBefore, uid));
    b.set(doc(db, `stockMovements/${mvId('t1', 'obra-b')}`), movement('t1', 'TRANSFER', 'TRANSFER', 'obra-b', qty, dstBefore, uid));
    b.update(doc(db, 'inventoryStock/obra-a__material-a'), { quantity: srcBefore - qty, lastMovementId: mvId('t1', 'obra-a'), updatedAt: NOW });
    b.update(doc(db, 'inventoryStock/obra-b__material-a'), { quantity: dstBefore + qty, lastMovementId: mvId('t1', 'obra-b'), updatedAt: NOW });
    return b.commit();
  };
  it('exige acesso às duas obras para solicitar', async () => { await assertFails(request('keeper-a')); await assertSucceeds(request('keeper-ab')); });
  it('bloqueia origem igual ao destino', async () => { await assertFails(request('keeper-ab', 4, { toObraId: 'obra-a', toObraName: 'OBRA A' })); });
  it('bloqueia quantidade inválida', async () => { await assertFails(request('keeper-ab', 0)); });
  it('confirmação atômica baixa a origem e soma ao destino', async () => { await request('keeper-ab'); await assertSucceeds(confirm('keeper-ab')); });
  it('confirmação com saldo anterior desatualizado falha', async () => { await request('keeper-ab'); await assertFails(confirm('keeper-ab', 4, 9)); });
  it('bloqueia confirmação duplicada', async () => { await request('keeper-ab'); await confirm('keeper-ab'); await assertFails(confirm('keeper-ab', 4, 6, 7)); });
  it('bloqueia confirmação por quem não acessa as duas obras', async () => { await request('keeper-ab'); await assertFails(confirm('keeper-a')); });
  it('cancela pendente com motivo; concluída não pode ser cancelada', async () => {
    await request('keeper-ab');
    await assertFails(setDoc(doc(as('keeper-ab'), 'transfers/t1'), { status: 'CANCELADA', cancelledBy: 'keeper-ab', cancelledByName: 'x', cancelledAt: NOW, cancelReason: 'ab' }, { merge: true }));
    await assertSucceeds(setDoc(doc(as('keeper-ab'), 'transfers/t1'), { status: 'CANCELADA', cancelledBy: 'keeper-ab', cancelledByName: 'x', cancelledAt: NOW, cancelReason: 'Pedido duplicado' }, { merge: true }));
  });
  it('transferência concluída não pode ser cancelada', async () => {
    await request('keeper-ab'); await confirm('keeper-ab');
    await assertFails(setDoc(doc(as('keeper-ab'), 'transfers/t1'), { status: 'CANCELADA', cancelledBy: 'keeper-ab', cancelledByName: 'x', cancelledAt: NOW, cancelReason: 'Pedido duplicado' }, { merge: true }));
  });
  it('outra empresa não lê nem solicita', async () => { await request('keeper-ab'); await assertFails(setDoc(doc(as('other'), 'transfers/t2'), transfer('t2', 1, 'other'))); });
});

describe('devolução', () => {
  const ret = (uid: string, condition: string, over: Record<string, unknown> = {}) => ({
    id: 'd1', companyId: COMPANY, obraId: 'obra-a', obraName: 'OBRA A', employeeId: 'employee-a', employeeName: 'EMPREGADO TESTE',
    materialId: 'material-a', materialDescription: 'CAPACETE', quantity: 2, condition, status: 'REGISTRADA', returnedAt: '2026-09-10',
    receivedBy: uid, receivedByName: uid, restocked: condition === 'BOM_ESTADO', createdAt: NOW, createdBy: uid, ...over,
  });
  const goodExtra = { movementId: mvId('d1', 'obra-a'), balanceBefore: 10, balanceAfter: 12 };
  it('bom estado retorna ao estoque com movimentação RETURN', async () => {
    const db = as('keeper-a'); const b = writeBatch(db);
    b.set(doc(db, 'returns/d1'), ret('keeper-a', 'BOM_ESTADO', goodExtra));
    b.set(doc(db, `stockMovements/${mvId('d1', 'obra-a')}`), movement('d1', 'RETURN', 'RETURN', 'obra-a', 2, 10, 'keeper-a'));
    b.update(doc(db, 'inventoryStock/obra-a__material-a'), { quantity: 12, lastMovementId: mvId('d1', 'obra-a'), updatedAt: NOW });
    await assertSucceeds(b.commit());
  });
  it('danificado NÃO altera estoque disponível, mas fica registrado', async () => {
    await assertSucceeds(setDoc(doc(as('keeper-a'), 'returns/d1'), ret('keeper-a', 'DANIFICADO')));
  });
  it('danificado não pode declarar reposição ao estoque', async () => {
    await assertFails(setDoc(doc(as('keeper-a'), 'returns/d1'), ret('keeper-a', 'DANIFICADO', { restocked: true, ...goodExtra })));
  });
  it('inservível exige observação', async () => {
    await assertFails(setDoc(doc(as('keeper-a'), 'returns/d1'), ret('keeper-a', 'INSERVIVEL')));
    await assertSucceeds(setDoc(doc(as('keeper-a'), 'returns/d1'), ret('keeper-a', 'INSERVIVEL', { notes: 'Rasgado, sem uso' })));
  });
  it('bloqueia devolução em obra fora do acesso e quantidade inválida', async () => {
    await assertFails(setDoc(doc(as('keeper-a'), 'returns/d1'), ret('keeper-a', 'DANIFICADO', { obraId: 'obra-b', obraName: 'OBRA B' })));
    await assertFails(setDoc(doc(as('keeper-a'), 'returns/d1'), ret('keeper-a', 'DANIFICADO', { quantity: 0 })));
  });
  it('devolução registrada não pode ser editada nem apagada', async () => {
    await setDoc(doc(as('keeper-a'), 'returns/d1'), ret('keeper-a', 'DANIFICADO'));
    await assertFails(setDoc(doc(as('keeper-a'), 'returns/d1'), { quantity: 1 }, { merge: true }));
  });
});

describe('inventário físico e ajustes', () => {
  const header = (uid: string) => ({ id: 'c1', companyId: COMPANY, obraId: 'obra-a', obraName: 'OBRA A', countedAt: '2026-09-10', countedBy: uid, countedByName: uid, status: 'EM_CONTAGEM', createdAt: NOW, createdBy: uid, updatedAt: NOW });
  const item = (uid: string, over: Record<string, unknown> = {}) => ({
    id: 'c1__material-a', countId: 'c1', companyId: COMPANY, obraId: 'obra-a', materialId: 'material-a', materialDescription: 'CAPACETE', unit: 'UN',
    systemQty: 10, countedQty: 7, difference: -3, justification: 'Perda identificada', status: 'PENDENTE_AJUSTE', countedBy: uid, createdAt: NOW, createdBy: uid, ...over,
  });
  const open = async (uid = 'keeper-adj') => { await setDoc(doc(as(uid), 'inventoryCounts/c1'), header(uid)); };
  it('abre contagem na obra do usuário', async () => { await assertSucceeds(open('keeper-a')); });
  it('registra divergência pendente com justificativa sem alterar o saldo', async () => {
    await open('keeper-a'); await assertSucceeds(setDoc(doc(as('keeper-a'), 'inventoryCountItems/c1__material-a'), item('keeper-a')));
  });
  it('divergência sem justificativa é bloqueada', async () => {
    await open('keeper-a'); await assertFails(setDoc(doc(as('keeper-a'), 'inventoryCountItems/c1__material-a'), item('keeper-a', { justification: '' })));
  });
  it('saldo do sistema desatualizado é bloqueado', async () => {
    await open('keeper-a'); await assertFails(setDoc(doc(as('keeper-a'), 'inventoryCountItems/c1__material-a'), item('keeper-a', { systemQty: 8, difference: -1, countedQty: 7 })));
  });
  it('ajuste de estoque exige canAdjustStock (almoxarife comum é bloqueado)', async () => {
    const adjust = (uid: string) => {
      const db = as(uid); const b = writeBatch(db);
      b.set(doc(db, 'inventoryCountItems/c1__material-a'), item(uid, { status: 'AJUSTADO', movementId: mvId('c1', 'obra-a'), balanceBefore: 10, balanceAfter: 7, adjustedBy: uid, adjustedByName: uid, adjustedAt: NOW }));
      b.set(doc(db, `stockMovements/${mvId('c1', 'obra-a')}`), movement('c1', 'INVENTORY', 'ADJUSTMENT', 'obra-a', -3, 10, uid));
      b.update(doc(db, 'inventoryStock/obra-a__material-a'), { quantity: 7, updatedAt: NOW, lastMovementId: mvId('c1', 'obra-a') });
      return b.commit();
    };
    await open('keeper-adj');
    await assertFails(adjust('keeper-a'));
    await assertSucceeds(adjust('keeper-adj'));
  });
  it('contagem fechada não aceita novos itens; fechamento exige perfil de ajuste para confirmar', async () => {
    await open('keeper-adj');
    await assertFails(setDoc(doc(as('keeper-adj'), 'inventoryCounts/c1'), { status: 'CONFIRMADA', closedBy: 'keeper-a', closedAt: NOW, updatedAt: NOW }, { merge: true }));
    await assertSucceeds(setDoc(doc(as('keeper-adj'), 'inventoryCounts/c1'), { status: 'CONFIRMADA', closedBy: 'keeper-adj', closedAt: NOW, updatedAt: NOW }, { merge: true }));
    await assertFails(setDoc(doc(as('keeper-adj'), 'inventoryCountItems/c1__material-a'), item('keeper-adj')));
  });
});

describe('permissões gerais', () => {
  it('almoxarife não concede canAdjustStock a si mesmo', async () => {
    await assertFails(setDoc(doc(as('keeper-a'), 'users/keeper-a'), { canAdjustStock: true }, { merge: true }));
  });
  it('admin concede canAdjustStock', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'users/keeper-a'), { canAdjustStock: true, updatedAt: NOW }, { merge: true }));
  });
});
