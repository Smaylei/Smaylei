// Substitui o módulo "cloudflare:workers" nos testes em Node.
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
