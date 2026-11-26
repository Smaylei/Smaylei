// Senhas: PBKDF2-SHA256 (WebCrypto da Cloudflare) com sal aleatório. Guardado como
// "pbkdf2$<iterações>$<sal base64>$<hash base64>"; a senha em si nunca é guardada.
const ITERACOES = 100_000;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(senha: string, sal: Uint8Array, iteracoes: number) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, chave, 256));
}

export async function gerarHash(senha: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACOES}$${b64(sal)}$${b64(await derivar(senha, sal, ITERACOES))}`;
}

export async function conferir(senha: string, guardado: string | null | undefined) {
  const [tipo, it, sal, hash] = String(guardado ?? '').split('$');
  if (tipo !== 'pbkdf2' || !sal || !hash) return false;
  const a = await derivar(senha, deB64(sal), Number(it)), b = deB64(hash);
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}

export const senhaValida = (s: unknown) => typeof s === 'string' && s.length >= 6 && s.length <= 64;

/** Senha provisória de 6 números (o Admin passa para a pessoa, que troca depois). */
export const senhaProvisoria = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
