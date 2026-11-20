// Página web simples dos pedidos (o App Admin é a forma principal).
// Página dos pedidos para a operação: pede a senha (ADMIN_TOKEN) e lista os fretes.
export const PAGINA_ADMIN = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pedidos de frete</title><style>
body{font-family:system-ui,sans-serif;background:#F2F5F3;color:#15201A;margin:0;padding:16px;max-width:760px;margin-inline:auto}
h1{font-size:22px}input,button{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #DAE2DD}button{background:#1B8048;color:#fff;border:0;font-weight:700}
.p{background:#fff;border:1px solid #DAE2DD;border-radius:12px;padding:12px 14px;margin:8px 0}.pago{border-left:6px solid #1B8048}.reservado{border-left:6px solid #C9A227;opacity:.75}.cancelado{border-left:6px solid #B42318;opacity:.6}.concluido{border-left:6px solid #5B6A62}
.t{display:flex;justify-content:space-between;gap:8px;font-weight:700}.m{color:#5B6A62;font-size:14px;margin-top:4px}a{color:#1B8048}
</style></head><body><h1>Pedidos de frete</h1>
<form id="f"><input id="s" type="password" placeholder="Senha" autocomplete="current-password"> <button>Entrar</button>
<label style="margin-left:8px"><input type="checkbox" id="todos"> mostrar todos</label></form><div id="l"></div>
<script>
const brl=v=>'R$ '+v.toFixed(2).replace('.',',');
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;};
async function carregar(){const s=document.getElementById('s').value||localStorage.getItem('senha')||'';if(!s)return;
 const r=await fetch('/admin/pedidos',{headers:{authorization:'Bearer '+s}});const l=document.getElementById('l');l.textContent='';
 if(!r.ok){l.append(el('p','', 'Senha incorreta.'));return;}localStorage.setItem('senha',s);
 const todos=document.getElementById('todos').checked;
 for(const p of await r.json()){ if(!todos&&p.status!=='pago')continue;
  const d=el('div','p '+p.status);const t=el('div','t');t.append(el('span','',p.mercadoNome+' → '+(p.cliente.nome||'Cliente')),el('span','',brl(p.valor)));d.append(t);
  d.append(el('div','m',({pago:'✓ Pago ('+(p.metodo==='pix'?'Pix':'cartão')+')',reservado:'Aguardando pagamento',cancelado:'✕ Cancelado',concluido:'✓ Concluído'}[p.status]||p.status)+' · '+(p.agendado?'Agendado: '+p.janela:'Urgente')+' · '+new Date(p.criadoEm).toLocaleString('pt-BR')));
  const m=el('div','m');m.append(el('span','',p.cliente.endereco+' '));const a=el('a','', 'abrir no mapa');a.href='https://www.google.com/maps/search/?api=1&query='+p.cliente.lat+','+p.cliente.lon;a.target='_blank';m.append(a);d.append(m);
  if(p.receiptUrl){const c=el('a','', 'comprovante');c.href=p.receiptUrl;c.target='_blank';const mm=el('div','m');mm.append(c);d.append(mm);}
  l.append(d);} }
document.getElementById('f').onsubmit=e=>{e.preventDefault();carregar();};document.getElementById('todos').onchange=carregar;carregar();setInterval(carregar,30000);
</script></body></html>`;

