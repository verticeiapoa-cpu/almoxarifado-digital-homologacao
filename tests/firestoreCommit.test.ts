import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { commitDocuments, encodeFields } from '../src/lib/firestoreCommit';
import config from '../firebase-applet-config.json';

const session = vi.hoisted(() => ({ user: { uid: 'admin', getIdToken: vi.fn(async () => 'test-token') } as { uid: string; getIdToken: () => Promise<string> } | null }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: session.user }) }));
const db = { app: { options: { projectId: config.projectId } } } as Firestore;
const writes = [{ path: 'inventoryStock/obra__epi', data: { quantity: 400, minimumStock: 30, unit: 'PAR', lowStockAlertSent: false }, exists: false }];
beforeEach(() => { session.user = { uid: 'admin', getIdToken: vi.fn(async () => 'test-token') }; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('commit condicional do Firebase', () => {
  it('envia valores inteiros, autenticação do usuário e condição de não existência', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ writeResults: [{}], commitTime: '2026-09-08T00:00:00Z' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await commitDocuments(db, writes, 'admin');
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents:commit`);
    expect(request.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer test-token' });
    const body = JSON.parse(String(request.body));
    expect(body.writes[0].currentDocument).toEqual({ exists: false });
    expect(body.writes[0].update.fields).toEqual({ quantity: { integerValue: '400' }, minimumStock: { integerValue: '30' }, unit: { stringValue: 'PAR' }, lowStockAlertSent: { booleanValue: false } });
  });
  it('preserva campos não editados no catálogo', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ writeResults: [{}], commitTime: 'now' })));
    vi.stubGlobal('fetch', fetchMock);
    await commitDocuments(db, [{ path: 'materials/epi', data: { ca: '123' }, exists: true, updateFields: ['ca'] }]);
    const request = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(request.body)).writes[0]).toMatchObject({ currentDocument: { exists: true }, updateMask: { fieldPaths: ['ca'] } });
  });
  it.each(['PERMISSION_DENIED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION'])('não transforma %s em sucesso', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { status } }), { status: 403 })));
    await expect(commitDocuments(db, writes)).rejects.toMatchObject({ code: status.toLowerCase().replaceAll('_', '-') });
  });
  it('rejeita confirmação incompleta do banco', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ writeResults: [] }))));
    await expect(commitDocuments(db, writes)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('não envia solicitações sem usuário autenticado', async () => {
    session.user = null;
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(commitDocuments(db, writes)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('não envia solicitações de outra sessão', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(commitDocuments(db, writes, 'different-user')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejeita números fracionários ou indefinidos antes de transmitir', () => {
    expect(() => encodeFields({ quantity: 1.5 })).toThrow();
    expect(() => encodeFields({ quantity: undefined })).toThrow();
  });
});
