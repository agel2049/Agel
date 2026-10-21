/* Session media are streamed from their live receiver tab, never cached. */
'use strict';
const bindings=new Map();
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuidPattern=new RegExp('^'+UUID+'$','i');
const route=new RegExp('^('+UUID+')/('+UUID+')\\.(jpg|jpeg|png|webp|avif|gif|bmp|ktx2|mp4|webm|ogv|mov|mp3|m4a|ogg|wav|glb|pdf)$','i');
const base=new URL('./',self.location.href),mediaBase=new URL('media/',base);
const MIME={jpg:['image/jpeg'],jpeg:['image/jpeg'],png:['image/png'],webp:['image/webp'],avif:['image/avif'],gif:['image/gif'],bmp:['image/bmp'],ktx2:['image/ktx2'],mp4:['video/mp4'],webm:['video/webm'],ogv:['video/ogg'],mov:['video/quicktime'],mp3:['audio/mpeg'],m4a:['audio/mp4'],ogg:['audio/ogg'],wav:['audio/wav'],glb:['model/gltf-binary','application/octet-stream'],pdf:['application/pdf']};
const safeHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function failure(status,message){return new Response(message,{status,headers:{...safeHeaders,'Content-Type':'text/plain; charset=utf-8'}});}
function owner(source){
  try{const url=new URL(source.url);return source.id&&url.origin===base.origin&&(url.pathname===base.pathname||url.pathname===new URL('index.html',base).pathname);}catch{return false;}
}
function release(binding){for(const abort of binding.pending)abort();binding.pending.clear();}
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('message',event=>{
  const m=event.data;if(!m||!uuidPattern.test(m.session||'')||!owner(event.source))return;
  const current=bindings.get(m.session);
  if(m.type==='agel-share-bind'){
    // A second tab cannot take over a live session's owner.
    if(current&&current.client!==event.source.id)return;
    if(!current)bindings.set(m.session,{client:event.source.id,pending:new Set()});
  }else if(m.type==='agel-share-unbind'&&current?.client===event.source.id){bindings.delete(m.session);release(current);}
});
async function serve(event,match){
  const [,session,asset,extension]=match,binding=bindings.get(session);
  if(!binding)return failure(410,'La sesión compartida terminó');
  const client=await self.clients.get(binding.client);
  if(!client||!owner(client)){bindings.delete(session);release(binding);return failure(410,'La sesión compartida terminó');}
  // PDF viewers create a navigation without a receiver clientId. The random
  // session and asset IDs still resolve exclusively through the bound live tab.
  if(event.clientId!==binding.client&&!(event.request.mode==='navigate'&&extension.toLowerCase()==='pdf'))return failure(403,'Recurso no autorizado');
  if(binding.pending.size>=16)return failure(429,'Demasiadas solicitudes de medios');
  if(event.request.method!=='GET')return failure(405,'Método no permitido');
  const range=event.request.headers.get('Range');if(range&&range.length>160)return failure(416,'Rango inválido');
  return new Promise(resolve=>{
    const {port1,port2}=new MessageChannel();let settled=false,finished=false,controller=null,pullResolve=null,remaining=0,pendingPull=false,timer;
    const signal=event.request.signal;
    function resetTimer(){clearTimeout(timer);timer=setTimeout(()=>abort('El equipo fuente no respondió'),15000);}
    function cleanup(cancel){
      if(finished)return;finished=true;clearTimeout(timer);binding.pending.delete(abort);signal.removeEventListener('abort',onAbort);
      if(cancel){try{port1.postMessage({op:'cancel'});}catch{}}
      port1.close();if(pullResolve){pullResolve();pullResolve=null;}
    }
    function abort(message='La sesión compartida terminó'){
      if(finished)return;cleanup(true);if(!settled){settled=true;resolve(failure(410,message));}else if(controller){try{controller.error(new Error(message));}catch{}}
    }
    function onAbort(){abort('Lectura cancelada');}
    binding.pending.add(abort);signal.addEventListener('abort',onAbort,{once:true});
    if(signal.aborted){onAbort();return;}
    port1.onmessage=event=>{
      if(finished)return;const m=event.data;
      if(!m||typeof m!=='object'){abort('Respuesta de medios inválida');return;}
      if(m.op==='headers'){
        if(settled){abort('Cabecera duplicada');return;}
        const h=m.headers||{},mime=h['Content-Type'],size=Number(h['Content-Length']);
        if(![200,206,416].includes(m.status)||!MIME[extension.toLowerCase()].includes(mime)||!Number.isSafeInteger(size)||size<0){abort('Tipo o tamaño de medio inválido');return;}
        const headers={...safeHeaders,'Content-Type':mime,'Content-Length':String(size),'Accept-Ranges':'bytes'};
        if(m.status===206){if(!/^bytes \d+-\d+\/\d+$/.test(h['Content-Range']||'')){abort('Rango inválido');return;}headers['Content-Range']=h['Content-Range'];}
        if(m.status===416){if(size!==0||!/^bytes \*\/\d+$/.test(h['Content-Range']||'')){abort('Rango inválido');return;}headers['Content-Range']=h['Content-Range'];}
        remaining=size;settled=true;
        if(size===0){cleanup(true);resolve(new Response(null,{status:m.status,headers}));return;}
        const body=new ReadableStream({
          start(c){controller=c;},
          pull(){if(finished||pendingPull)return;pendingPull=true;resetTimer();return new Promise(r=>{pullResolve=r;port1.postMessage({op:'pull'});});},
          cancel(){cleanup(true);}
        },{highWaterMark:0});
        resolve(new Response(body,{status:m.status,headers}));clearTimeout(timer);
      }else if(m.op==='chunk'){
        if(!settled||!controller||!pendingPull||!(m.chunk instanceof ArrayBuffer)||m.chunk.byteLength===0||m.chunk.byteLength>60*1024||m.chunk.byteLength>remaining){abort('Bloque de medio inválido');return;}
        clearTimeout(timer);remaining-=m.chunk.byteLength;pendingPull=false;controller.enqueue(new Uint8Array(m.chunk));if(pullResolve){const done=pullResolve;pullResolve=null;done();}
      }else if(m.op==='end'){
        if(!settled||remaining!==0){abort('Lectura de medio incompleta');return;}cleanup(false);controller?.close();
      }else if(m.op==='error')abort('El equipo fuente cerró la transferencia');
      else abort('Respuesta de medios inválida');
    };
    port1.onmessageerror=()=>abort('No se pudo leer el medio');port1.start();resetTimer();
    try{client.postMessage({type:'agel-share-fetch',session,asset,range},[port2]);}catch{abort();}
  });
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(url.origin!==mediaBase.origin||!url.pathname.startsWith(mediaBase.pathname))return;
  const match=route.exec(url.pathname.slice(mediaBase.pathname.length));if(!match)return;
  event.respondWith(serve(event,match));
});
