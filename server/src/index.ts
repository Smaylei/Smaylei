// Worker da MOVI: encaminha tudo para a Central (Durable Object com SQLite).
// A lógica fica em central.ts.
import { erro, type Env } from './central';

export { Central } from './central';

// Marca da versão publicada (para conferir se a Cloudflare já está com o código novo).
const VERSAO = 'delivery-1';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname } = new URL(req.url);
    if (pathname === '/versao') return new Response(VERSAO, { headers: CORS });
    if (pathname.startsWith('/v2/') || pathname === '/retorno' || pathname === '/webhook' || pathname === '/agenda.ics') {
      const central = env.CENTRAL.get(env.CENTRAL.idFromName('central'));
      return central.fetch(req);
    }
    return erro('Rota não encontrada.', 404);
  },
};
