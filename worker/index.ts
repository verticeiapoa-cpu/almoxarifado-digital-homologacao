import { handleStockAlert, securityHeaders, type AlertEnv } from '../server/stockAlert';
interface Env extends AlertEnv { ASSETS: { fetch(request: Request): Promise<Response> }; }
export default {
  async fetch(request: Request, env: Env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/stock-alert' || pathname === '/api/stock-alert/status') return handleStockAlert(request, env);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    Object.entries(securityHeaders).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
