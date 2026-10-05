import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleStockAlert } from '../server/stockAlert';
import api from '../api/stock-alert';
import statusApi from '../api/stock-alert/status';
const env = { BREVO_API_KEY: 'mock-only', BREVO_SENDER_EMAIL: 'sender@example.invalid' };
const request = (body: unknown = { companyId: 'company', stockId: 'obra__material' }, token = 'mock-token') => new Request('https://example.invalid/api/stock-alert', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const str = (stringValue: string) => ({ stringValue });
const stock = { companyId: str('company'), quantity: { integerValue: '2' }, minimumStock: { integerValue: '3' }, lowStockAlertSent: { booleanValue: false }, materialDescription: str('<Luva>'), obraName: str('Obra'), unit: str('UN') };
function mockService(settings: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}, brevoStatus = 201) {
  const mock = vi.fn(async (url: string | URL | Request) => {
    const value = String(url);
    if (value.includes('accounts:lookup')) return Response.json({ users: [{ localId: 'uid', emailVerified: true }] });
    if (value.includes('stockAlertSettings')) return Response.json({ fields: { companyId: str('company'), enabled: { booleanValue: true }, recipientEmail: str('recipient@example.invalid'), ...settings } });
    if (value.includes('inventoryStock')) return Response.json({ fields: { ...stock, ...overrides } });
    if (value.includes('brevo')) return Response.json({}, { status: brevoStatus });
    throw new Error('Unexpected network access');
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
afterEach(() => vi.unstubAllGlobals());
describe('API de alertas na Vercel', () => {
  it('expõe status JSON sem segredo', async () => {
    const response = await statusApi.fetch(new Request('https://example.invalid/api/stock-alert/status'));
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toHaveProperty('configured');
  });
  it('recusa envio sem sessão e sem acessar serviços externos', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await api.fetch(request({}, ''))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('recusa origem cruzada', async () => { const req = request(); req.headers.set('origin', 'https://other.invalid'); expect((await handleStockAlert(req, env)).status).toBe(403); });
  it('recusa método não permitido', async () => expect((await handleStockAlert(new Request('https://example.invalid/api/stock-alert'), env)).status).toBe(405));
  it('informa configuração ausente depois de validar sessão', async () => { mockService(); expect((await handleStockAlert(request(), {})).status).toBe(503); });
  it('recusa token inválido', async () => { vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 400 }))); expect((await handleStockAlert(request(), env)).status).toBe(401); });
  it('recusa identificadores inválidos', async () => { mockService(); expect((await handleStockAlert(request({ companyId: '../company', stockId: 'stock' }), env)).status).toBe(400); });
  it('recusa estoque de outra empresa', async () => { const mock = mockService({}, { companyId: str('other') }); expect((await handleStockAlert(request(), env)).status).toBe(403); expect(mock).toHaveBeenCalledTimes(3); });
  it.each([{ enabled: { booleanValue: false } }, {}])('envia somente quando necessário', async settings => {
    const mock = mockService(settings, settings.enabled ? {} : { lowStockAlertSent: { booleanValue: true } });
    expect(await (await handleStockAlert(request(), env)).json()).toMatchObject({ sent: false });
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it('envia dados do estoque com HTML escapado usando transporte simulado', async () => {
    const mock = mockService(); expect(await (await handleStockAlert(request(), env)).json()).toEqual({ sent: true });
    const options = mock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(JSON.parse(String(options.body)).htmlContent).toContain('&lt;Luva&gt;');
  });
  it('não confirma alerta recusado pelo provedor', async () => { mockService({}, {}, 400); expect((await handleStockAlert(request(), env)).status).toBe(502); });
  it('retorna JSON quando a rede falha', async () => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); })); expect((await handleStockAlert(request(), env)).status).toBe(503); });
});
