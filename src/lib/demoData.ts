import { collection, documentId, getDocsFromServer, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { commitDocuments } from './firestoreCommit';

const DEMO_OBRAS = [
  { id: 'demo-centro-administrativo', name: 'CENTRO ADMINISTRATIVO', address: 'AV. IPIRANGA, 1200 - PORTO ALEGRE/RS', cno: 'DEMO-CNO-001' },
  { id: 'demo-residencial-horizonte', name: 'RESIDENCIAL HORIZONTE', address: 'RUA DAS ACÁCIAS, 480 - CANOAS/RS', cno: 'DEMO-CNO-002' },
  { id: 'demo-parque-das-aguas', name: 'PARQUE DAS ÁGUAS', address: 'AV. CENTRAL, 950 - GRAVATAÍ/RS', cno: 'DEMO-CNO-003' },
];

const DEMO_EMPLOYEES = [
  { id: 'demo-funcionario-joao', name: 'JOÃO SILVA (DEMO)', cpf: 'CPF-DEMO-001', jobTitle: 'PEDREIRO', obraId: 'demo-centro-administrativo', obraName: 'CENTRO ADMINISTRATIVO', obraCno: 'DEMO-CNO-001', isOutsourced: false },
  { id: 'demo-funcionario-mariana', name: 'MARIANA COSTA (DEMO)', cpf: 'CPF-DEMO-002', jobTitle: 'TÉCNICA DE SEGURANÇA', obraId: 'demo-residencial-horizonte', obraName: 'RESIDENCIAL HORIZONTE', obraCno: 'DEMO-CNO-002', isOutsourced: false },
  { id: 'demo-funcionario-carlos', name: 'CARLOS OLIVEIRA (DEMO)', cpf: 'CPF-DEMO-003', jobTitle: 'ELETRICISTA', obraId: 'demo-parque-das-aguas', obraName: 'PARQUE DAS ÁGUAS', obraCno: 'DEMO-CNO-003', isOutsourced: true },
];

const DEMO_MATERIALS = [
  ['demo-epi-capacete', 'CAPACETE DE SEGURANÇA COM JUGULAR', '12345', 38, 10],
  ['demo-epi-luva-nitrilica', 'LUVA NITRÍLICA', '67890', 8, 12],
  ['demo-epi-oculos', 'ÓCULOS DE PROTEÇÃO INCOLOR', '54321', 24, 8],
  ['demo-epi-protetor-auricular', 'PROTETOR AURICULAR TIPO PLUG', '98765', 6, 10],
  ['demo-epi-botina', 'BOTINA DE SEGURANÇA COM BIQUEIRA', '45678', 18, 6],
  ['demo-epi-cinto', 'CINTO PARAQUEDISTA COM TALABARTE', '33445', 5, 3],
  ['demo-epi-respirador', 'RESPIRADOR DESCARTÁVEL PFF2', '41123', 42, 20],
  ['demo-epi-colete', 'COLETE REFLETIVO DE ALTA VISIBILIDADE', '22678', 12, 5],
  ['demo-epi-protetor-facial', 'PROTETOR FACIAL INCOLOR', '51234', 4, 5],
  ['demo-epi-abafador', 'ABAFADOR DE RUÍDO TIPO CONCHA', '30999', 9, 4],
  ['demo-epi-luva-vaqueta', 'LUVA DE VAQUETA', '18888', 15, 8],
  ['demo-epi-creme', 'CREME PROTETOR PARA AS MÃOS', '44556', 7, 5],
];

async function createIfMissing(collectionName: string, id: string, data: Record<string, unknown>) {
  const snapshot = await getDocsFromServer(query(collection(db, collectionName),
    where('companyId', '==', data.companyId), where(documentId(), '==', id)));
  if (!snapshot.empty) return;
  try {
    await commitDocuments(db, [{ path: `${collectionName}/${id}`, data, exists: false }]);
  } catch (error) {
    // Another administrator may have initialized the same demo at the same time.
    // Never overwrite a balance, including zero, already saved by another session.
    if (error && typeof error === 'object' && 'code' in error && ['already-exists', 'failed-precondition'].includes(String(error.code))) return;
    throw error;
  }
}

export async function ensureDemoData(companyId: string) {
  const now = new Date().toISOString();

  await Promise.all(DEMO_OBRAS.map(obra => createIfMissing('obras', obra.id, {
    ...obra,
    companyId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })));

  await Promise.all(DEMO_EMPLOYEES.map(employee => createIfMissing('employees', employee.id, {
    ...employee,
    companyId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })));

  await Promise.all(DEMO_MATERIALS.map(([id, description, ca]) => createIfMissing('materials', String(id), {
    id,
    description,
    ca,
    companyId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })));

  await Promise.all(DEMO_OBRAS.flatMap((obra, obraIndex) => DEMO_MATERIALS.map(([materialId, description, ca, baseQuantity, minimumStock], materialIndex) => {
    const id = `${obra.id}__${materialId}`;
    const quantity = Math.max(1, Number(baseQuantity) - (obraIndex * 3) + (materialIndex % 3));
    return createIfMissing('inventoryStock', id, {
      id,
      companyId,
      obraId: obra.id,
      obraName: obra.name,
      materialId,
      materialDescription: description,
      ca,
      quantity,
      minimumStock,
      unit: 'UN',
      lowStockAlertSent: false,
      createdAt: now,
      updatedAt: now,
    });
  })));
}
