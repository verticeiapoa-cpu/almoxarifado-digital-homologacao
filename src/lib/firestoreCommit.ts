import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import config from '../../firebase-applet-config.json';

export interface ConditionalWrite {
  path: string;
  data: Record<string, unknown>;
  exists: boolean;
  updateFields?: string[];
}

export function encodeFields(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => {
    if (typeof value === 'string') return [key, { stringValue: value }];
    if (typeof value === 'boolean') return [key, { booleanValue: value }];
    if (typeof value === 'number' && Number.isSafeInteger(value)) return [key, { integerValue: String(value) }];
    throw new Error(`Valor inválido no campo ${key}.`);
  }));
}

/**
 * The Web SDK has no create-only batch operation. REST commit provides an
 * exists:false precondition without reading a nonexistent document. Firebase
 * evaluates the same user security rules and commits all writes atomically.
 */
export async function commitDocuments(db: Firestore, writes: ConditionalWrite[], expectedUid?: string) {
  const user = getAuth(db.app).currentUser;
  if (!user || (expectedUid && user.uid !== expectedUid)) {
    throw Object.assign(new Error('Sessão inválida.'), { code: 'unauthenticated' });
  }
  const project = db.app.options.projectId;
  if (project !== config.projectId) throw new Error('Banco de dados incorreto.');
  const database = `projects/${project}/databases/${config.firestoreDatabaseId}`;
  const body = JSON.stringify({ writes: writes.map(write => ({
    update: { name: `${database}/documents/${write.path}`, fields: encodeFields(write.data) },
    currentDocument: { exists: write.exists },
    ...(write.updateFields ? { updateMask: { fieldPaths: write.updateFields } } : {}),
  })) });
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`https://firestore.googleapis.com/v1/${database}/documents:commit`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body, signal: controller.signal,
    });
    const result = await response.json() as { error?: { status?: string }; writeResults?: unknown[]; commitTime?: string };
    if (!response.ok) {
      const status = result.error?.status || (response.status === 403 ? 'PERMISSION_DENIED' : 'UNAVAILABLE');
      throw Object.assign(new Error('Não foi possível confirmar a gravação no banco de dados.'), { code: status.toLowerCase().replaceAll('_', '-') });
    }
    if (result.writeResults?.length !== writes.length || !result.commitTime) {
      throw Object.assign(new Error('O banco não confirmou todas as alterações.'), { code: 'unavailable' });
    }
  } finally {
    clearTimeout(timeout);
  }
}
