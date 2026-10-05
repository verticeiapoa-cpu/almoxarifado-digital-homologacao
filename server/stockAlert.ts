export interface AlertEnv {
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
}

const FIREBASE_PROJECT = 'gen-lang-client-0038131539';
const FIRESTORE_DATABASE = 'ai-studio-docbrief-694b79f8-8d07-4aec-ab6b-3d02339ff834';

export const securityHeaders = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const withSecurityHeaders = (headers: HeadersInit = {}) => ({
  ...securityHeaders,
  ...headers,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: withSecurityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }),
});

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function stringValue(fields: Record<string, { stringValue?: string }>, name: string) {
  return fields[name]?.stringValue || '';
}

function integerValue(fields: Record<string, { integerValue?: string }>, name: string) {
  return Number(fields[name]?.integerValue || 0);
}

function booleanValue(fields: Record<string, { booleanValue?: boolean }>, name: string) {
  return Boolean(fields[name]?.booleanValue);
}

async function firestoreGet(path: string, token: string) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/${FIRESTORE_DATABASE}/documents/${path}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Firestore ${response.status}`);
  return response.json() as Promise<{ name: string; fields: Record<string, { stringValue?: string; integerValue?: string; booleanValue?: boolean }> }>;
}

async function verifyFirebaseToken(token: string) {
  const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyBUdWYdoea5glHBgbH7kC37edSl3_85wYo', {
    signal: AbortSignal.timeout(10_000),
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token }),
  });
  if (!response.ok) return null;
  const result = await response.json() as { users?: Array<{ localId: string; emailVerified: boolean }> };
  const claims = result.users?.[0];
  if (!claims?.localId || !claims.emailVerified) return null;
  return claims;
}

async function sendStockAlert(request: Request, env: AlertEnv) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origem inválida.' }, 403);
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const claims = token ? await verifyFirebaseToken(token) : null;
  if (!claims) return json({ error: 'Sessão inválida.' }, 401);
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    return json({ error: 'O serviço Brevo ainda não está configurado.' }, 503);
  }


  let payload: { companyId?: string; stockId?: string };
  try { payload = await request.json(); }
  catch { return json({ error: 'Dados inválidos.' }, 400); }
  if (!payload || typeof payload.companyId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.companyId) || typeof payload.stockId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.stockId)) {
    return json({ error: 'Estoque inválido.' }, 400);
  }

  try {
    const [settingsDoc, stockDoc] = await Promise.all([
      firestoreGet(`stockAlertSettings/${encodeURIComponent(payload.companyId)}`, token),
      firestoreGet(`inventoryStock/${encodeURIComponent(payload.stockId)}`, token),
    ]);
    const settings = settingsDoc.fields;
    const stock = stockDoc.fields;
    if (stringValue(settings, 'companyId') !== payload.companyId || stringValue(stock, 'companyId') !== payload.companyId) {
      return json({ error: 'Empresa inválida.' }, 403);
    }
    if (!booleanValue(settings, 'enabled')) return json({ sent: false, reason: 'disabled' });
    const quantity = integerValue(stock, 'quantity');
    const minimum = integerValue(stock, 'minimumStock');
    if (minimum <= 0 || quantity > minimum || booleanValue(stock, 'lowStockAlertSent')) {
      return json({ sent: false, reason: 'not_due' });
    }
    const recipient = stringValue(settings, 'recipientEmail');
    const description = stringValue(stock, 'materialDescription');
    const obraName = stringValue(stock, 'obraName');
    const unit = stringValue(stock, 'unit') || 'UN';
    if (!recipient) return json({ error: 'Destinatário não configurado.' }, 422);

    const brevo = await fetch('https://api.brevo.com/v3/smtp/email', {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME || 'WSELENT' },
        to: [{ email: recipient }],
        subject: `Estoque baixo em ${obraName}: ${description}`,
        htmlContent: `<h2>Alerta de estoque baixo</h2><p>Obra: <strong>${escapeHtml(obraName)}</strong></p><p><strong>${escapeHtml(description)}</strong> atingiu o estoque mínimo.</p><p>Saldo atual: <strong>${quantity} ${escapeHtml(unit)}</strong><br>Estoque mínimo: <strong>${minimum} ${escapeHtml(unit)}</strong></p><p>Almoxarifado Digital WSELENT</p>`,
        textContent: `${description} atingiu o estoque mínimo na obra ${obraName}. Saldo atual: ${quantity} ${unit}. Estoque mínimo: ${minimum} ${unit}.`,
      }),
    });
    if (!brevo.ok) {
      console.error('Brevo error status', brevo.status);
      return json({ error: 'O Brevo recusou o envio.' }, 502);
    }
    return json({ sent: true });
  } catch (error) {
    console.error('Stock alert error status', error instanceof Error ? error.name : 'unknown-error');
    return json({ error: 'Não foi possível enviar o alerta.' }, 500);
  }
}


export async function handleStockAlert(request: Request, env: AlertEnv): Promise<Response> {
  try {
    if (new URL(request.url).pathname.endsWith('/status')) {
      if (request.method !== 'GET') return json({ error: 'Método não permitido.' }, 405);
      return json({ configured: Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL) });
    }
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    return await sendStockAlert(request, env);
  } catch {
    return json({ error: 'Serviço temporariamente indisponível. Tente novamente.' }, 503);
  }
}
