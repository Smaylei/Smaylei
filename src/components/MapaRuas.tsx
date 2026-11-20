import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import dados from '../../web/guaramirim-ruas.json';
import { cores } from './tema';

export type EstadoMapa = {
  modo: 'escolher' | 'rota';
  casa: { lat: number; lon: number } | null;
  mercados: { id: string; curto: string; lat: number; lon: number }[];
  sel?: string | null;
  rota?: { ida: [number, number][]; volta: [number, number][] } | null;
  rua?: string | null; // rua a destacar e enquadrar
  motorista?: { lat: number; lon: number } | null; // posição ao vivo do motorista
};

type Props = {
  estado: EstadoMapa;
  onEscolher?: (p: { lat: number; lon: number }) => void;
  style?: ViewStyle;
};

// Desenho em <canvas> dentro de uma WebView: sem chave de API e funciona offline.
const SCRIPT = String.raw`
(function(){
  var D = window.DADOS, est = null;
  var LAT_C=-26.4744, LON_C=-48.9981, KX=Math.cos(LAT_C*Math.PI/180)*111320, KY=110540;
  var n = D.n.length/2, X = new Float64Array(n), Y = new Float64Array(n), LA = new Float64Array(n), LO = new Float64Array(n);
  for (var i=0;i<n;i++){ LA[i]=D.base[0]+D.n[2*i]/1e5; LO[i]=D.base[1]+D.n[2*i+1]/1e5; X[i]=(LO[i]-LON_C)*KX; Y[i]=(LA[i]-LAT_C)*KY; }
  var proj = function(la,lo){ return [(lo-LON_C)*KX,(la-LAT_C)*KY]; };
  var paths = D.classes.map(function(){ return new Path2D(); });
  var porNome = {};
  D.w.forEach(function(w){ var p=paths[w[0]]; p.moveTo(X[w[3]],Y[w[3]]); for (var k=4;k<w.length;k++) p.lineTo(X[w[k]],Y[w[k]]);
    var nm=D.nomes[w[1]]; if(nm){ (porNome[nm]=porNome[nm]||[]).push(w); } });
  var ESTILO = {motorway:[5,'#F2C94C'],trunk:[5,'#F2C94C'],primary:[4.5,'#F2C94C'],secondary:[4,'#F6D77A'],tertiary:[3.2,'#FFFFFF'],link:[3,'#FFFFFF'],
    unclassified:[2.4,'#FFFFFF'],residential:[2.4,'#FFFFFF'],road:[2.2,'#FFFFFF'],living_street:[2,'#FFFFFF'],service:[1.4,'#DCE2DD'],track:[1.2,'#DCE2DD']};
  var ORDEM=['track','service','living_street','road','residential','unclassified','link','tertiary','secondary','primary','trunk','motorway'];
  var cv=document.getElementById('c'), ctx=cv.getContext('2d'), W=0,H=0,dpr=1, view={cx:0,cy:0,s:0.2};
  function tam(){ dpr=window.devicePixelRatio||1; W=window.innerWidth; H=window.innerHeight; cv.width=W*dpr; cv.height=H*dpr; cv.style.width=W+'px'; cv.style.height=H+'px'; }
  function tela(x,y){ return [(x-view.cx)*view.s+W/2, H/2-(y-view.cy)*view.s]; }
  function mundo(sx,sy){ return [(sx-W/2)/view.s+view.cx, (H/2-sy)/view.s+view.cy]; }
  function enquadrar(pts,pad){ if(!pts.length||!W) return; var x0=1e18,y0=1e18,x1=-1e18,y1=-1e18;
    pts.forEach(function(p){ x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]); });
    var w=Math.max(x1-x0,120), h=Math.max(y1-y0,120); view.cx=(x0+x1)/2; view.cy=(y0+y1)/2;
    view.s=Math.max(0.01,Math.min((W-2*pad)/w,(H-2*pad)/h,2.5)); }
  var ruaPath=null;
  function linha(pts){ var p=new Path2D(); pts.forEach(function(q,k){ var xy=proj(q[0],q[1]); if(k) p.lineTo(xy[0],xy[1]); else p.moveTo(xy[0],xy[1]); }); return p; }
  function desenhar(){
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.fillStyle='#EEF1EC'; ctx.fillRect(0,0,W,H); if(!est) return;
    var z=Math.max(0.55,Math.min(1.6,Math.sqrt(view.s/0.25)));
    ctx.setTransform(view.s*dpr,0,0,-view.s*dpr,(W/2-view.cx*view.s)*dpr,(H/2+view.cy*view.s)*dpr); ctx.lineCap='round'; ctx.lineJoin='round';
    if (view.s>0.12) ORDEM.forEach(function(nm){ var ci=D.classes.indexOf(nm); if(ci<0||ESTILO[nm][1]==='#DCE2DD') return; ctx.lineWidth=(ESTILO[nm][0]*z+1.6)/view.s; ctx.strokeStyle='#C9D1CB'; ctx.stroke(paths[ci]); });
    ORDEM.forEach(function(nm){ var ci=D.classes.indexOf(nm); if(ci<0) return; ctx.lineWidth=ESTILO[nm][0]*z/view.s; ctx.strokeStyle=ESTILO[nm][1]; ctx.stroke(paths[ci]); });
    if (ruaPath && est.modo==='escolher'){ ctx.globalAlpha=0.35; ctx.lineWidth=7*z/view.s; ctx.strokeStyle='#1B8048'; ctx.stroke(ruaPath); ctx.globalAlpha=1; }
    if (est.modo==='rota' && est.rota){ ctx.lineWidth=5/view.s; ctx.strokeStyle='#2F6FD6'; ctx.setLineDash([10/view.s,7/view.s]); ctx.stroke(linha(est.rota.volta));
      ctx.setLineDash([]); ctx.strokeStyle='#1B8048'; ctx.stroke(linha(est.rota.ida)); }
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.font='600 12px -apple-system, Roboto, sans-serif';
    (est.mercados||[]).forEach(function(m){ var s=tela.apply(null,proj(m.lat,m.lon)); var at=m.id===est.sel;
      ctx.beginPath(); ctx.arc(s[0],s[1],at?9:7,0,7); ctx.fillStyle=at?'#1B8048':'#FFFFFF'; ctx.fill(); ctx.lineWidth=2.5; ctx.strokeStyle='#1B8048'; ctx.stroke();
      if (est.modo==='rota' && !at) return; rot(m.curto,s[0]+12,s[1]+4,at); });
    if (est.casa){ var s=tela.apply(null,proj(est.casa.lat,est.casa.lon)), x=s[0], y=s[1];
      ctx.fillStyle='#D2463C'; ctx.beginPath(); ctx.moveTo(x,y); ctx.bezierCurveTo(x-12,y-14,x-9,y-28,x,y-28); ctx.bezierCurveTo(x+9,y-28,x+12,y-14,x,y); ctx.fill();
      ctx.beginPath(); ctx.arc(x,y-19,4,0,7); ctx.fillStyle='#FFFFFF'; ctx.fill(); rot('Casa',x+12,y-14,false); }
    var pm = posMotorista();
    if (pm){ var mm=tela.apply(null,proj(pm[0],pm[1]));
      ctx.beginPath(); ctx.arc(mm[0],mm[1],13,0,7); ctx.fillStyle='#2F6FD6'; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle='#FFFFFF'; ctx.stroke();
      ctx.font='14px sans-serif'; ctx.fillText('🚗',mm[0]-8,mm[1]+5); ctx.font='600 12px -apple-system, Roboto, sans-serif'; rot('Motorista',mm[0]+16,mm[1]+4,false); }
  }
  function rot(t,x,y,f){ var w=ctx.measureText(t).width; ctx.fillStyle='rgba(255,255,255,.9)'; ctx.fillRect(x-3,y-12,w+6,16); ctx.fillStyle=f?'#1B8048':'#15201A'; ctx.fillText(t,x,y); }
  function reenquadrar(){
    var pts=[];
    if (est.modo==='rota' && est.rota){ est.rota.ida.concat(est.rota.volta).forEach(function(q){ pts.push(proj(q[0],q[1])); }); }
    else if (est.modo==='escolher' && ruaPath && est._ruaPts){ pts=est._ruaPts; }
    if (est.casa) pts.push(proj(est.casa.lat,est.casa.lon));
    if (est.motorista) pts.push(proj(est.motorista.lat,est.motorista.lon));
    if (!pts.length || (est.modo==='escolher' && !ruaPath && !est.casa)) (est.mercados||[]).forEach(function(m){ pts.push(proj(m.lat,m.lon)); });
    enquadrar(pts, 50);
  }
  // Carro deslizando entre uma posição e a próxima (como nos apps de corrida).
  var anim = null, DUR = 3000;
  function posMotorista(){
    if (!est || !est.motorista) return null;
    if (!anim) return [est.motorista.lat, est.motorista.lon];
    var t = Math.min(1, (performance.now()-anim.t0)/DUR), e = t*(2-t);
    return [anim.de[0]+(anim.para[0]-anim.de[0])*e, anim.de[1]+(anim.para[1]-anim.de[1])*e];
  }
  function quadro(){ if (!anim) return; desenhar(); if (performance.now()-anim.t0 < DUR) requestAnimationFrame(quadro); else anim=null; }
  window.mfEstado = function(novo){
    var antes = est;
    if (antes && antes.motorista && novo.motorista && (antes.motorista.lat!==novo.motorista.lat || antes.motorista.lon!==novo.motorista.lon)) {
      var atual = posMotorista() || [antes.motorista.lat, antes.motorista.lon];
      anim = { de: atual, para: [novo.motorista.lat, novo.motorista.lon], t0: performance.now() };
      requestAnimationFrame(quadro);
    }
    est = novo;
    if (!antes || antes.rua !== novo.rua){ ruaPath=null; est._ruaPts=null;
      if (novo.rua && porNome[novo.rua]){ ruaPath=new Path2D(); var pts=[]; porNome[novo.rua].forEach(function(w){ ruaPath.moveTo(X[w[3]],Y[w[3]]);
        for (var k=3;k<w.length;k++){ ruaPath.lineTo(X[w[k]],Y[w[k]]); pts.push([X[w[k]],Y[w[k]]]); } }); est._ruaPts=pts; } }
    else est._ruaPts = antes._ruaPts;
    var mudouCasa = !antes || JSON.stringify(antes.casa)!==JSON.stringify(novo.casa);
    var surgiuMotorista = !!novo.motorista && !(antes && antes.motorista);
    if (!antes || antes.rua!==novo.rua || antes.sel!==novo.sel || antes.modo!==novo.modo || surgiuMotorista || (mudouCasa && novo.modo==='rota')) reenquadrar();
    desenhar();
  };
  var ptrs={}, nptr=0, moveu=0, pinca=null;
  function zoomEm(sx,sy,f){ var m=mundo(sx,sy); view.s=Math.max(0.01,Math.min(view.s*f,4)); view.cx=m[0]-(sx-W/2)/view.s; view.cy=m[1]+(sy-H/2)/view.s; desenhar(); }
  cv.addEventListener('pointerdown',function(e){ cv.setPointerCapture(e.pointerId); ptrs[e.pointerId]=[e.clientX,e.clientY]; nptr=Object.keys(ptrs).length; moveu=0;
    if(nptr===2){ var v=Object.values(ptrs); pinca={d:Math.hypot(v[0][0]-v[1][0],v[0][1]-v[1][1]),s:view.s}; } });
  cv.addEventListener('pointermove',function(e){ var a=ptrs[e.pointerId]; if(!a) return; var nx=e.clientX, ny=e.clientY; ptrs[e.pointerId]=[nx,ny];
    if (nptr===1){ moveu+=Math.abs(nx-a[0])+Math.abs(ny-a[1]); view.cx-=(nx-a[0])/view.s; view.cy+=(ny-a[1])/view.s; desenhar(); }
    else if (nptr===2 && pinca){ var v=Object.values(ptrs), d=Math.hypot(v[0][0]-v[1][0],v[0][1]-v[1][1]); zoomEm((v[0][0]+v[1][0])/2,(v[0][1]+v[1][1])/2,(pinca.s*d/pinca.d)/view.s); moveu=99; } });
  function solta(e){ var tinha=!!ptrs[e.pointerId]; delete ptrs[e.pointerId]; nptr=Object.keys(ptrs).length; if(nptr<2) pinca=null;
    if (tinha && e.type==='pointerup' && moveu<8 && nptr===0 && est && est.modo==='escolher'){
      var m=mundo(e.clientX,e.clientY), best=-1, bd=1e18; for (var i=0;i<n;i++){ var dx=X[i]-m[0], dy=Y[i]-m[1], dd=dx*dx+dy*dy; if(dd<bd){bd=dd;best=i;} }
      var d=Math.sqrt(bd), la, lo; if (d<Math.min(120,40/view.s)){ la=LA[best]; lo=LO[best]; } else { la=m[1]/KY+LAT_C; lo=m[0]/KX+LON_C; }
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({tipo:'pin',lat:la,lon:lo})); } }
  cv.addEventListener('pointerup',solta); cv.addEventListener('pointercancel',solta);
  document.getElementById('mais').onclick=function(){ zoomEm(W/2,H/2,1.6); };
  document.getElementById('menos').onclick=function(){ zoomEm(W/2,H/2,1/1.6); };
  window.addEventListener('resize',function(){ tam(); if(est) reenquadrar(); desenhar(); });
  tam(); desenhar();
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({tipo:'pronto'}));
})();
`;

function html() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#EEF1EC;touch-action:none}canvas{display:block;touch-action:none}
.z{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;gap:6px}
.z button{width:38px;height:38px;border-radius:10px;border:1px solid #DAE2DD;background:#fff;font-size:20px;font-weight:600;color:#15201A}
.a{position:absolute;right:6px;bottom:4px;font:10px sans-serif;color:#5B6A62}</style></head>
<body><canvas id="c"></canvas><div class="z"><button id="mais">+</button><button id="menos">−</button></div>
<div class="a">© colaboradores do OpenStreetMap</div>
<script>window.DADOS=${JSON.stringify(dados)};</script><script>${SCRIPT}</script></body></html>`;
}

let htmlCache: string | null = null;

export default function MapaRuas({ estado, onEscolher, style }: Props) {
  const ref = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  const pronto = useRef(false);
  const fonte = useMemo(() => ({ html: (htmlCache ??= html()) }), []);
  const json = JSON.stringify(estado);

  useEffect(() => {
    if (pronto.current) ref.current?.injectJavaScript(`window.mfEstado(${json});true;`);
  }, [json]);

  function aoReceber(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.tipo === 'pronto') {
        pronto.current = true;
        ref.current?.injectJavaScript(`window.mfEstado(${json});true;`);
      } else if (msg.tipo === 'pin') onEscolher?.({ lat: msg.lat, lon: msg.lon });
    } catch {
      // mensagem desconhecida
    }
  }

  return (
    <View style={[s.caixa, style]}>
      <WebView
        ref={ref as never}
        source={fonte}
        originWhitelist={['*']}
        onMessage={aoReceber}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        style={s.web}
      />
    </View>
  );
}

const s = StyleSheet.create({
  caixa: { height: 320, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: cores.borda },
  web: { flex: 1, backgroundColor: '#EEF1EC' },
});
