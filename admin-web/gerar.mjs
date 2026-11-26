// Empacota o build web do Admin (dist-admin) num Worker com os arquivos embutidos.
// Uso: node admin-web/gerar.mjs && npx wrangler deploy --config admin-web/wrangler.jsonc
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const raiz = new URL('../dist-admin/', import.meta.url).pathname;
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const arquivos = {};
const andar = (d) => readdirSync(d).forEach((n) => {
  const p = join(d, n);
  if (statSync(p).isDirectory()) andar(p);
  else arquivos['/' + relative(raiz, p)] = [tipos[extname(p)] ?? 'application/octet-stream', readFileSync(p).toString('base64')];
});
andar(raiz);
mkdirSync(new URL('./.build/', import.meta.url), { recursive: true });
writeFileSync(new URL('./.build/worker.mjs', import.meta.url), `const A = ${JSON.stringify(arquivos)};
const bin = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
export default {
  fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    let a = A[p] ?? A[p + '.html'] ?? A[p.replace(/\\/$/, '') + '/index.html'];
    const html = !a; // rota do app (SPA): devolve o index.html
    if (!a) a = A['/index.html'];
    return new Response(bin(a[1]), { headers: { 'content-type': a[0], 'cache-control': html || a[0].startsWith('text/html') ? 'no-cache' : 'public, max-age=31536000, immutable', 'x-robots-tag': 'noindex' } });
  },
};
`);
console.log(Object.keys(arquivos).length, 'arquivos');
