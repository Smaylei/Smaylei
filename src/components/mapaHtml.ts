// Página do mapa (sem Google e sem chave): MapLibre GL + tiles do OpenFreeMap (OpenStreetMap).
// Usada no celular (WebView) e no painel web (iframe). Recebe o estado por window.mfEstado(...)
// e devolve { tipo: 'pronto' } e { tipo: 'pin', lat, lon } (toque no mapa no modo "escolher").
import { cores } from './tema';

export const MAPLIBRE = 'https://unpkg.com/maplibre-gl@4.7.1/dist';
export const ESTILO_MAPA = 'https://tiles.openfreemap.org/styles/dark';

export function htmlMapa() {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css">
<script src="${MAPLIBRE}/maplibre-gl.js"></script>
<style>
html,body,#m{margin:0;height:100%;background:${cores.fundo};font-family:system-ui,sans-serif}
.casa{width:34px;height:34px;border-radius:17px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,.6);border:3px solid ${cores.primaria}}
.loja{width:max-content;padding:4px 9px;border-radius:12px;background:${cores.cartao};color:#fff;font-size:12px;font-weight:700;border:1.5px solid #3a3f46;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.5)}
.loja.sel{background:${cores.primaria};border-color:${cores.primaria}}
.carro{width:38px;height:38px;border-radius:19px;background:${cores.primaria};display:flex;align-items:center;justify-content:center;font-size:20px;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.6)}
.aviso{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:${cores.suave};text-align:center;padding:20px}
.maplibregl-ctrl-attrib{font-size:10px}
</style></head><body><div id="m"></div><script>
(function(){
var enviar=function(o){var s=JSON.stringify(o);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else if(window.parent!==window)window.parent.postMessage(s,'*');};
var est=null,pronto=false;
window.mfEstado=function(e){est=e;if(pronto)aplicar();};
window.addEventListener('message',function(ev){try{var m=typeof ev.data==='string'?JSON.parse(ev.data):ev.data;if(m&&m.tipo==='estado')window.mfEstado(m.estado);}catch(x){}});
if(!window.maplibregl){document.body.innerHTML='<div class="aviso">Mapa indisponível sem internet.</div>';enviar({tipo:'pronto'});return;}
var map=new maplibregl.Map({container:'m',style:'${ESTILO_MAPA}',center:[-48.998,-26.4745],zoom:12.5,attributionControl:{compact:true},dragRotate:false,pitchWithRotate:false});
map.touchZoomRotate.disableRotation();window.mfMapa=map;map.on('error',function(e){console.log('mapa erro',e&&e.error&&e.error.message);});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
var vazio={type:'FeatureCollection',features:[]};
var mCasa=null,mks={},carro=null,de=null,para=null,t0=0,chave='',centro='';
function el(c,h){var d=document.createElement('div');d.className=c;d.innerHTML=h;return d;}
function linha(p){return{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:p.map(function(x){return[x[1],x[0]];})}};}
function anima(){var k=Math.min(1,(performance.now()-t0)/2500);var e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;carro.setLngLat([de[0]+(para[0]-de[0])*e,de[1]+(para[1]-de[1])*e]);if(k<1)requestAnimationFrame(anima);}
function aplicar(){
  var e=est,pts=[];
  if(e.casa){var ll=[e.casa.lon,e.casa.lat];if(!mCasa)mCasa=new maplibregl.Marker({element:el('casa','🏠')}).setLngLat(ll).addTo(map);else mCasa.setLngLat(ll);pts.push(ll);}
  else if(mCasa){mCasa.remove();mCasa=null;}
  var ids={};
  (e.mercados||[]).forEach(function(m){ids[m.id]=1;var sel=e.sel===m.id;var ll=[m.lon,m.lat];
    if(!mks[m.id])mks[m.id]=new maplibregl.Marker({element:el('loja','')}).setLngLat(ll).addTo(map);
    var d=mks[m.id].getElement();d.className='loja'+(sel?' sel':'');d.textContent=m.curto;mks[m.id].setLngLat(ll);if(sel||e.modo==='rota')pts.push(ll);});
  Object.keys(mks).forEach(function(k){if(!ids[k]){mks[k].remove();delete mks[k];}});
  var r=e.rota,feats=[];if(r&&r.ida&&r.ida.length>1)feats.push(linha(r.ida));if(r&&r.volta&&r.volta.length>1)feats.push(linha(r.volta));
  var src=map.getSource('rota');if(src)src.setData({type:'FeatureCollection',features:feats});
  if(e.motorista){var p=[e.motorista.lon,e.motorista.lat];pts.push(p);
    if(!carro){carro=new maplibregl.Marker({element:el('carro','🚗')}).setLngLat(p).addTo(map);para=p;}
    else if(!para||para[0]!==p[0]||para[1]!==p[1]){var a=carro.getLngLat();de=[a.lng,a.lat];para=p;t0=performance.now();requestAnimationFrame(anima);}}
  else if(carro){carro.remove();carro=null;para=null;}
  var c=e.centro?e.centro.lat+','+e.centro.lon:'';
  if(c&&c!==centro&&!e.casa){centro=c;map.jumpTo({center:[e.centro.lon,e.centro.lat],zoom:13});}
  // Enquadra quando mudam os pontos (no modo escolher, só na primeira vez).
  var k=e.modo==='escolher'?(pts.length?'x':''):pts.map(function(p){return p[0].toFixed(3)+','+p[1].toFixed(3);}).join('|')+(e.motorista?'':'');
  if(k&&k!==chave&&pts.length){chave=k;if(pts.length===1)map.jumpTo({center:pts[0],zoom:15});else{var b=new maplibregl.LngLatBounds(pts[0],pts[0]);pts.forEach(function(p){b.extend(p);});map.fitBounds(b,{padding:60,maxZoom:15,duration:0});}}
}
map.on('load',function(){
  map.addSource('rota',{type:'geojson',data:vazio});
  map.addLayer({id:'rota-fundo',type:'line',source:'rota',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#000','line-width':9,'line-opacity':.55}});
  map.addLayer({id:'rota',type:'line',source:'rota',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'${cores.primaria}','line-width':5}});
  pronto=true;if(est)aplicar();enviar({tipo:'pronto'});
});
map.on('click',function(ev){if(est&&est.modo==='escolher')enviar({tipo:'pin',lat:ev.lngLat.lat,lon:ev.lngLat.lng});});
})();
</script></body></html>`;
}
