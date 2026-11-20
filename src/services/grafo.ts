// Rotas pelas ruas de Guaramirim (OpenStreetMap, ODbL) calculadas no próprio aparelho:
// mesmo mapa e mesma regra da versão PC (web/mercado-frete.html), sem depender de internet.

import dados from '../../web/guaramirim-ruas.json';
import type { Trajeto } from './preco';

type Dados = {
  base: [number, number];
  classes: string[];
  nomes: string[];
  n: number[];
  w: number[][];
  mercados: { id: string; lat: number; lon: number }[];
};

// Velocidades médias por tipo de via (km/h)
const VELOC: Record<string, number> = {
  motorway: 80, trunk: 70, primary: 60, secondary: 45, tertiary: 40, unclassified: 35,
  residential: 30, living_street: 15, service: 15, road: 30, track: 20, link: 40,
};
const ACESSO_KMH = 20; // trecho entre o ponto exato e a rua mais próxima
const LAT_C = -26.4744;
const LON_C = -48.9981;
const KX = Math.cos((LAT_C * Math.PI) / 180) * 111320;
const KY = 110540;

type Csr = { start: Int32Array; adj: Int32Array; to: Int32Array };
type Grafo = { n: number; X: Float64Array; Y: Float64Array; lat: Float64Array; lon: Float64Array; el: Float64Array; es: Float64Array; fwd: Csr; rev: Csr };

let cache: Grafo | null = null;

function montar(): Grafo {
  const d = dados as unknown as Dados;
  const n = d.n.length / 2;
  const lat = new Float64Array(n), lon = new Float64Array(n), X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = d.base[0] + d.n[2 * i] / 1e5;
    lon[i] = d.base[1] + d.n[2 * i + 1] / 1e5;
    X[i] = (lon[i] - LON_C) * KX;
    Y[i] = (lat[i] - LAT_C) * KY;
  }
  const ef: number[] = [], et: number[] = [], el: number[] = [], es: number[] = [];
  for (const w of d.w) {
    const vel = VELOC[d.classes[w[0]]] / 3.6;
    const ow = w[2];
    for (let k = 4; k < w.length; k++) {
      const a = w[k - 1], b = w[k];
      const L = Math.hypot(X[b] - X[a], Y[b] - Y[a]);
      if (ow !== -1) { ef.push(a); et.push(b); el.push(L); es.push(L / vel); }
      if (ow !== 1) { ef.push(b); et.push(a); el.push(L); es.push(L / vel); }
    }
  }
  const m = ef.length;
  const csr = (from: number[], to: number[]): Csr => {
    const start = new Int32Array(n + 1);
    for (let i = 0; i < m; i++) start[from[i] + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const pos = start.slice(0, n), adj = new Int32Array(m);
    for (let i = 0; i < m; i++) adj[pos[from[i]]++] = i;
    return { start, adj, to: Int32Array.from(to) };
  };
  return { n, X, Y, lat, lon, el: Float64Array.from(el), es: Float64Array.from(es), fwd: csr(ef, et), rev: csr(et, ef) };
}

const grafo = () => (cache ??= montar());
const proj = (lat: number, lon: number): [number, number] => [(lon - LON_C) * KX, (lat - LAT_C) * KY];

function maisProximo(G: Grafo, x: number, y: number) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < G.n; i++) {
    const dx = G.X[i] - x, dy = G.Y[i] - y, dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = i; }
  }
  return { i: best, d: Math.sqrt(bd) };
}

function dijkstra(G: Grafo, g: Csr, src: number) {
  const T = new Float64Array(G.n).fill(Infinity), D = new Float64Array(G.n), P = new Int32Array(G.n).fill(-1);
  const hv: number[] = [], hn: number[] = [];
  const troca = (i: number, j: number) => { [hv[i], hv[j]] = [hv[j], hv[i]]; [hn[i], hn[j]] = [hn[j], hn[i]]; };
  const push = (t: number, v: number) => {
    hv.push(t); hn.push(v);
    let i = hv.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= hv[i]) break; troca(p, i); i = p; }
  };
  const pop = (): [number, number] => {
    const t = hv[0], v = hn[0], lt = hv.pop()!, lv = hn.pop()!;
    if (hv.length) {
      hv[0] = lt; hn[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < hv.length && hv[l] < hv[s]) s = l;
        if (r < hv.length && hv[r] < hv[s]) s = r;
        if (s === i) break;
        troca(s, i); i = s;
      }
    }
    return [t, v];
  };
  T[src] = 0; push(0, src);
  while (hv.length) {
    const [t, u] = pop();
    if (t > T[u]) continue;
    for (let k = g.start[u]; k < g.start[u + 1]; k++) {
      const e = g.adj[k], v = g.to[e], nt = t + G.es[e];
      if (nt < T[v]) { T[v] = nt; D[v] = D[u] + G.el[e]; P[v] = u; push(nt, v); }
    }
  }
  return { T, D, P };
}

export type Ponto = { lat: number; lon: number };
export type RotaMercado = Trajeto & {
  /** Caminhos (lat, lon) para desenhar no mapa */
  ida: [number, number][];
  volta: [number, number][];
};

/**
 * Rotas mercado → casa (ida) e casa → mercado (volta) para todos os mercados,
 * com duas buscas no total (uma no grafo invertido, outra no normal).
 */
export function rotasAteCasa(casa: Ponto, mercados: ({ id: string } & Ponto)[]): Record<string, RotaMercado | null> {
  const G = grafo();
  const [cx, cy] = proj(casa.lat, casa.lon);
  const hc = maisProximo(G, cx, cy);
  const ida = dijkstra(G, G.rev, hc.i);
  const volta = dijkstra(G, G.fwd, hc.i);
  const caminho = (P: Int32Array, de: number) => {
    const out: [number, number][] = [[G.lat[de], G.lon[de]]];
    for (let v = de; v !== hc.i && v >= 0; ) { v = P[v]; if (v >= 0) out.push([G.lat[v], G.lon[v]]); }
    return out;
  };
  const res: Record<string, RotaMercado | null> = {};
  for (const m of mercados) {
    const [mx, my] = proj(m.lat, m.lon);
    const hm = maisProximo(G, mx, my);
    if (!Number.isFinite(ida.T[hm.i]) || !Number.isFinite(volta.T[hm.i])) { res[m.id] = null; continue; }
    const acesso = hm.d + hc.d;
    const minAcesso = (acesso / 1000 / ACESSO_KMH) * 60;
    res[m.id] = {
      kmIda: (ida.D[hm.i] + acesso) / 1000,
      kmVolta: (volta.D[hm.i] + acesso) / 1000,
      minIda: ida.T[hm.i] / 60 + minAcesso,
      minVolta: volta.T[hm.i] / 60 + minAcesso,
      ida: caminho(ida.P, hm.i),
      volta: caminho(volta.P, hm.i),
    };
  }
  return res;
}

/** Nomes de ruas do mapa, para localizar a rua digitada no cadastro. */
export function acharRua(texto: string): string | null {
  const d = dados as unknown as Dados;
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const t = norm(texto).replace(/^r\.?\s/, 'rua ').replace(/^av\.?\s/, 'avenida ');
  if (t.length < 4) return null;
  const nomes = d.nomes.filter(Boolean).map((nm) => [norm(nm), nm] as const).sort((a, b) => b[0].length - a[0].length);
  for (const [nn, nm] of nomes) if (t.startsWith(nn)) return nm;
  for (const [nn, nm] of nomes) if (t.includes(nn)) return nm;
  return null;
}
