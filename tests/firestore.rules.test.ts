import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, where, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const COMPANY = 'wselent-default';
const OTHER_COMPANY = 'other-company';
const ADMIN_EMAIL = 'verticeiapoa@gmail.com';

let env: RulesTestEnvironment;

const profile = (uid: string, email: string, role: 'admin' | 'storekeeper', obraIds: string[], companyId = COMPANY) => ({
  uid,
  email,
  name: uid,
  companyId,
  role,
  assignedObraIds: obraIds,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
});

const delivery = (uid: string, email: string, obraId = 'obra-a', companyId = COMPANY) => ({
  id: 'delivery-a',
  timestamp: '2026-09-06T00:00:00.000Z',
  serverCreatedAt: serverTimestamp(),
  responsibleUser: uid,
  companyId,
  obraId,
  employeeHomeObraId: obraId,
  employeeHomeObraName: 'OBRA A',
  employeeHomeObraCno: obraId === 'obra-a' ? '11.111.11111/11' : '22.222.22222/22',
  serviceObraId: obraId,
  serviceObraName: 'OBRA A',
  stockObraId: obraId,
  stockObraName: 'OBRA A',
  isFloatingEmployee: false,
  temporaryAssignmentId: '',
  temporaryAssignmentReason: '',
  employeeId: 'employee-a',
  employeeName: 'EMPREGADO TESTE',
  employeeCpf: '000.000.000-00',
  employeeJobTitle: 'SERVENTE',
  employeeObraName: 'OBRA A',
  employeeIsOutsourced: false,
  items: [{ description: 'CAPACETE', ca: '123', quantity: 1, materialId: 'material-a', stockId: `${obraId}__material-a` }],
  status: 'COMPLETED',
  signatureUrl: `data:image/png;base64,${'a'.repeat(150)}`,
  signatureHash: 'a'.repeat(64),
  audit: {
    authUid: uid,
    authEmail: email,
    signedAt: '2026-09-06T00:00:00.000Z',
    signatureMethod: 'drawn-on-screen',
    consentText: 'Recebimento confirmado.',
  },
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  createdBy: uid,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-almoxarifado',
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/admin'), profile('admin', ADMIN_EMAIL, 'admin', ['ALL']));
    await setDoc(doc(db, 'users/storekeeper'), profile('storekeeper', 'almoxarife@example.com', 'storekeeper', ['obra-a']));
    await setDoc(doc(db, 'users/other-admin'), profile('other-admin', 'other@example.com', 'admin', ['ALL'], OTHER_COMPANY));
    await setDoc(doc(db, 'obras/obra-a'), { id: 'obra-a', name: 'OBRA A', address: '', cno: '11.111.11111/11', companyId: COMPANY, isActive: true });
    await setDoc(doc(db, 'obras/obra-b'), { id: 'obra-b', name: 'OBRA B', address: '', cno: '22.222.22222/22', companyId: COMPANY, isActive: true });
    await setDoc(doc(db, 'obras/obra-other'), { id: 'obra-other', name: 'OUTRA', address: '', companyId: OTHER_COMPANY, isActive: true });
    await setDoc(doc(db, 'employees/employee-a'), { id: 'employee-a', name: 'EMPREGADO TESTE', cpf: '000.000.000-00', jobTitle: 'SERVENTE', obraId: 'obra-a', obraName: 'OBRA A', obraCno: '11.111.11111/11', companyId: COMPANY, isOutsourced: false, isActive: true });
    await setDoc(doc(db, 'employees/employee-b'), { id: 'employee-b', name: 'B', cpf: '111.111.111-11', jobTitle: 'B', obraId: 'obra-b', obraName: 'OBRA B', obraCno: '22.222.22222/22', companyId: COMPANY, isOutsourced: false, isActive: true });
    await setDoc(doc(db, 'employees/employee-other'), { id: 'employee-other', name: 'O', cpf: '', jobTitle: 'O', obraId: 'obra-other', obraName: 'OUTRA', companyId: OTHER_COMPANY, isOutsourced: false, isActive: true });
    await setDoc(doc(db, 'materials/material-a'), { id: 'material-a', description: 'CAPACETE', ca: '123', companyId: COMPANY, isActive: true });
    await setDoc(doc(db, 'inventoryStock/obra-a__material-a'), {
      id: 'obra-a__material-a', companyId: COMPANY, obraId: 'obra-a', obraName: 'OBRA A',
      materialId: 'material-a', materialDescription: 'CAPACETE', ca: '123', quantity: 10,
      minimumStock: 5, unit: 'UN', lowStockAlertSent: false, createdAt: 'x', updatedAt: 'x',
    });
  });
});

afterAll(async () => env.cleanup());

describe('autenticação e convites', () => {
  it('bloqueia usuário autenticado sem perfil nem convite', async () => {
    const db = env.authenticatedContext('unknown', { email: 'unknown@example.com' }).firestore();
    await assertFails(getDoc(doc(db, 'employees/employee-a')));
    await assertFails(setDoc(doc(db, 'users/unknown'), profile('unknown', 'unknown@example.com', 'storekeeper', ['obra-a'])));
  });

  it('permite o bootstrap somente do administrador principal', async () => {
    const db = env.authenticatedContext('main-admin', { email: ADMIN_EMAIL, email_verified: true }).firestore();
    await assertSucceeds(setDoc(doc(db, 'users/main-admin'), profile('main-admin', ADMIN_EMAIL, 'admin', ['ALL'])));
  });

  it('bloqueia o bootstrap quando o e-mail administrativo não está verificado', async () => {
    const db = env.authenticatedContext('unverified-admin', { email: ADMIN_EMAIL, email_verified: false }).firestore();
    await assertFails(setDoc(doc(db, 'users/unverified-admin'), profile('unverified-admin', ADMIN_EMAIL, 'admin', ['ALL'])));
  });

  it('não permite um segundo e-mail de bootstrap administrativo', async () => {
    const secondaryEmail = 'rmvmv1988@gmail.com';
    const db = env.authenticatedContext('secondary-bootstrap', { email: secondaryEmail, email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, 'users/secondary-bootstrap'), profile('secondary-bootstrap', secondaryEmail, 'admin', ['ALL'])));
  });

  it('permite que um convidado crie apenas o perfil definido no convite', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'invitations/invited@example.com'), {
        email: 'invited@example.com', name: 'Convidado', companyId: COMPANY,
        role: 'storekeeper', assignedObraIds: ['obra-a'], status: 'pending',
        createdAt: 'x', updatedAt: 'x', createdBy: 'admin',
      });
    });
    const db = env.authenticatedContext('invited', { email: 'invited@example.com' }).firestore();
    await assertSucceeds(setDoc(doc(db, 'users/invited'), profile('invited', 'invited@example.com', 'storekeeper', ['obra-a'])));
  });
});

describe('RBAC e isolamento', () => {
  it('permite consulta administrativa de alocações sem liberar outras empresas', async () => {
    const db = env.authenticatedContext('admin', { email: ADMIN_EMAIL, email_verified: true }).firestore();
    await assertSucceeds(getDocs(query(collection(db, 'temporaryAssignments'), where('companyId', '==', COMPANY), where('employeeId', '==', 'employee-a'))));
    await assertFails(getDocs(query(collection(db, 'temporaryAssignments'), where('companyId', '==', OTHER_COMPANY))));
    await assertFails(getDocs(collection(db, 'temporaryAssignments')));
  });

  it('restringe o almoxarife às obras atribuídas', async () => {
    const db = env.authenticatedContext('storekeeper', { email: 'almoxarife@example.com' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'employees/employee-a')));
    await assertFails(getDoc(doc(db, 'employees/employee-b')));
    await assertFails(getDoc(doc(db, 'employees/employee-other')));
  });

  it('impede almoxarife de alterar perfil, obra e catálogo', async () => {
    const db = env.authenticatedContext('storekeeper', { email: 'almoxarife@example.com' }).firestore();
    await assertFails(updateDoc(doc(db, 'users/storekeeper'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'obras/obra-a'), { name: 'INVADIDA' }));
    await assertFails(updateDoc(doc(db, 'materials/material-a'), { description: 'INVADIDO' }));
    await assertFails(updateDoc(doc(db, 'employees/employee-a'), { obraId: 'obra-b', obraName: 'OBRA B', obraCno: '22.222.22222/22' }));
  });

  it('impede administrador de acessar outra empresa', async () => {
    const db = env.authenticatedContext('admin', { email: ADMIN_EMAIL, email_verified: true }).firestore();
    await assertFails(getDoc(doc(db, 'employees/employee-other')));
  });

  it('separa configuração administrativa da baixa operacional de estoque', async () => {
    const adminDb = env.authenticatedContext('admin', { email: ADMIN_EMAIL, email_verified: true }).firestore();
    const storekeeperDb = env.authenticatedContext('storekeeper', { email: 'almoxarife@example.com' }).firestore();
    await assertSucceeds(updateDoc(doc(adminDb, 'inventoryStock/obra-a__material-a'), { minimumStock: 6 }));
    await assertSucceeds(updateDoc(doc(storekeeperDb, 'inventoryStock/obra-a__material-a'), { quantity: 9, updatedAt: 'y' }));
    await assertFails(updateDoc(doc(storekeeperDb, 'inventoryStock/obra-a__material-a'), { quantity: 11, updatedAt: 'y' }));
    const settings = {
      id: COMPANY, companyId: COMPANY, recipientEmail: ADMIN_EMAIL, enabled: true,
      createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', updatedBy: 'admin',
    };
    await assertSucceeds(setDoc(doc(adminDb, `stockAlertSettings/${COMPANY}`), settings));
    await assertFails(setDoc(doc(storekeeperDb, `stockAlertSettings/${COMPANY}`), { ...settings, updatedBy: 'storekeeper' }));
    await assertSucceeds(setDoc(doc(adminDb, 'mail/alert-a'), {
      to: [ADMIN_EMAIL],
      message: { subject: 'Estoque baixo', text: 'Saldo baixo', html: '<p>Saldo baixo</p>' },
      companyId: COMPANY, obraId: 'obra-a', stockId: 'obra-a__material-a', materialId: 'material-a', requestedBy: 'admin', createdAt: '2026-09-07T00:00:00.000Z',
    }));
    await assertSucceeds(setDoc(doc(storekeeperDb, 'mail/alert-b'), {
      to: [ADMIN_EMAIL],
      message: { subject: 'Estoque baixo', text: 'Saldo baixo', html: '<p>Saldo baixo</p>' },
      companyId: COMPANY, obraId: 'obra-a', stockId: 'obra-a__material-a', materialId: 'material-a', requestedBy: 'storekeeper', createdAt: '2026-09-07T00:00:00.000Z',
    }));
  });
});

describe('histórico de entregas', () => {
  it('permite entrega válida e impede alteração ou exclusão posterior', async () => {
    const db = env.authenticatedContext('storekeeper', { email: 'almoxarife@example.com' }).firestore();
    const ref = doc(db, 'deliveries/delivery-a');
    await assertSucceeds(setDoc(ref, delivery('storekeeper', 'almoxarife@example.com')));
    await assertFails(updateDoc(ref, { status: 'ALTERED' }));
    await assertFails(deleteDoc(ref));
  });

  it('limita cada entrega a no máximo cinco EPIs', async () => {
    const db = env.authenticatedContext('storekeeper', { email: 'almoxarife@example.com' }).firestore();
    const sixItems = Array.from({ length: 6 }, (_, index) => ({
      description: `EPI ${index + 1}`,
      ca: String(100 + index),
      quantity: 1,
      materialId: `material-${index + 1}`,
      stockId: `obra-a__material-${index + 1}`,
    }));
    await assertFails(setDoc(doc(db, 'deliveries/too-many-items'), {
      ...delivery('storekeeper', 'almoxarife@example.com'),
      id: 'too-many-items',
      items: sixItems,
    }));
  });

  it('rejeita entrega sem assinatura ou em obra não autorizada', async () => {
    const db = env.authenticatedContext('storekeeper', { email: 'almoxarife@example.com' }).firestore();
    await assertFails(setDoc(doc(db, 'deliveries/no-signature'), {
      ...delivery('storekeeper', 'almoxarife@example.com'),
      id: 'no-signature',
      signatureUrl: '',
    }));
    await assertFails(setDoc(doc(db, 'deliveries/wrong-obra'), {
      ...delivery('storekeeper', 'almoxarife@example.com', 'obra-b'),
      id: 'wrong-obra',
    }));
    await assertFails(setDoc(doc(db, 'deliveries/invalid-item'), {
      ...delivery('storekeeper', 'almoxarife@example.com'),
      id: 'invalid-item',
      items: [{ description: 'CAPACETE', ca: '123', quantity: '1' }],
    }));
  });

  it('permite entrega temporária na obra anfitriã sem mudar o vínculo permanente', async () => {
    const startsAt = Timestamp.fromMillis(Date.now() - 60_000);
    const endsAt = Timestamp.fromMillis(Date.now() + 3_600_000);
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'users/host-storekeeper'), profile('host-storekeeper', 'host@example.com', 'storekeeper', ['obra-b']));
      await setDoc(doc(db, 'temporaryAssignments/assignment-a'), {
        id: 'assignment-a', companyId: COMPANY, employeeId: 'employee-a', employeeName: 'EMPREGADO TESTE',
        homeObraId: 'obra-a', homeObraName: 'OBRA A', hostObraId: 'obra-b', hostObraName: 'OBRA B',
        startsAt, endsAt, reason: 'Apoio emergencial por dois dias', status: 'ACTIVE', createdAt: 'x', updatedAt: 'x', createdBy: 'admin',
      });
      await setDoc(doc(db, 'temporaryEmployeeAccess/employee-a'), {
        id: 'employee-a', employeeId: 'employee-a', companyId: COMPANY, hostObraId: 'obra-b',
        assignmentId: 'assignment-a', startsAt, endsAt, active: true,
      });
    });

    const db = env.authenticatedContext('host-storekeeper', { email: 'host@example.com' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'employees/employee-a')));
    const floatingDelivery = {
      ...delivery('host-storekeeper', 'host@example.com'),
      id: 'floating-delivery',
      employeeHomeObraCno: '11.111.11111/11',
      serviceObraId: 'obra-b',
      serviceObraName: 'OBRA B',
      stockObraId: 'obra-b',
      stockObraName: 'OBRA B',
      isFloatingEmployee: true,
      temporaryAssignmentId: 'assignment-a',
      temporaryAssignmentReason: 'Apoio emergencial por dois dias',
    };
    await assertSucceeds(setDoc(doc(db, 'deliveries/floating-delivery'), floatingDelivery));
    const permanentEmployee = await getDoc(doc(db, 'employees/employee-a'));
    if (permanentEmployee.data()?.obraId !== 'obra-a') throw new Error('O vínculo permanente foi alterado.');
  });

  it('bloqueia entrega flutuante sem autorização temporária válida', async () => {
    const db = env.authenticatedContext('admin', { email: ADMIN_EMAIL, email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, 'deliveries/floating-without-assignment'), {
      ...delivery('admin', ADMIN_EMAIL),
      id: 'floating-without-assignment',
      employeeHomeObraCno: '11.111.11111/11',
      serviceObraId: 'obra-b',
      serviceObraName: 'OBRA B',
      stockObraId: 'obra-b',
      stockObraName: 'OBRA B',
      isFloatingEmployee: true,
      temporaryAssignmentId: 'missing',
      temporaryAssignmentReason: 'Sem autorização válida',
    }));
  });
});
