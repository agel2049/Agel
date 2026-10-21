/* Ephemeral, pull-driven media transport. Nothing is persisted by this module. */
(function(root){
  'use strict';
  const MAX_REQUESTS=16,MAX_QUEUE=1024*1024,MAX_METADATA=4*1024*1024,MAX_CHUNK=60*1024;
  const MEDIA=/^(?:image\/(?:jpeg|png|webp|avif|gif|bmp|ktx2)|video\/(?:mp4|webm|ogg|quicktime)|audio\/(?:mpeg|mp4|webm|ogg|wav)|model\/gltf-binary|application\/(?:octet-stream|pdf))$/;
  const idOK=id=>Number.isInteger(id)&&id>0&&id<=0xffffffff;
  function rangeFor(range,size){
    if(range==null||range==='')return {status:200,start:0,end:size};
    const m=typeof range==='string'&&/^bytes=(\d*)-(\d*)$/.exec(range);
    const bad={status:416,start:0,end:0};
    if(!m||(!m[1]&&!m[2])||size===0)return bad;
    let start=m[1]?Number(m[1]):null,end=m[2]?Number(m[2]):null;
    if((start!==null&&!Number.isSafeInteger(start))||(end!==null&&!Number.isSafeInteger(end)))return bad;
    if(start===null){if(end===0)return bad;start=Math.max(0,size-end);end=size;}
    else {if(start>=size||(end!==null&&end<start))return bad;end=end===null?size:Math.min(end,size-1)+1;}
    return {status:206,start,end};
  }
  function endpoint(channel,options,host){
    options=options||{};
    if(!channel||channel.readyState!=='open')throw new Error('La conexión no está abierta');
    const requests=new Map(),listeners=[],waiters=new Set();let closed=false,nextId=1;
    // DataChannel does not expose SCTP; peer.js supplies maxMessageSize when available.
    const known=Number(channel.maxMessageSize),localFrame=Number.isFinite(known)&&known>=256?Math.min(known,MAX_CHUNK+4):16384;
    let frameSize=localFrame;
    channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=MAX_QUEUE/2;
    function listen(name,fn){channel.addEventListener(name,fn);listeners.push([name,fn]);}
    function close(reason='La sesión compartida terminó',notify=true){
      if(closed)return;
      if(notify&&channel.readyState==='open'){try{channel.send(JSON.stringify({op:'close'}));}catch{}}
      closed=true;for(const [name,fn]of listeners)channel.removeEventListener(name,fn);
      for(const wake of waiters)wake();waiters.clear();
      for(const r of requests.values()){r.cancelled=true;if(r.port){try{r.port.postMessage({op:'error',message:reason});}catch{}r.port.close();}}
      requests.clear();try{options.onClose?.(reason);}catch{}
    }
    function send(message){if(closed||channel.readyState!=='open')throw new Error('La sesión compartida terminó');channel.send(typeof message==='string'||message instanceof ArrayBuffer?message:JSON.stringify(message));}
    function release(r){if(requests.get(r.id)!==r)return;requests.delete(r.id);r.cancelled=true;if(r.port)r.port.close();}
    function fail(r,message){if(r.cancelled)return;if(host){try{send({op:'error',id:r.id,message});}catch{close();}}else{try{send({op:'cancel',id:r.id});}catch{}try{r.port.postMessage({op:'error',message});}catch{}}release(r);}
    async function writable(bytes,r){
      while(!closed&&!r.cancelled&&(channel.bufferedAmount||0)+bytes>MAX_QUEUE){
        await new Promise(resolve=>{let timer;const wake=()=>{clearTimeout(timer);channel.removeEventListener('bufferedamountlow',wake);waiters.delete(wake);resolve();};waiters.add(wake);channel.addEventListener('bufferedamountlow',wake);timer=setTimeout(wake,25);});
      }
      return !closed&&!r.cancelled;
    }
    function headers(blob,asset,range){
      if(!blob||!Number.isSafeInteger(blob.size)||blob.size<0||typeof blob.slice!=='function')throw Error('Archivo no disponible');
      const mime=String(blob.type||'application/octet-stream').toLowerCase();
      if(asset==='manifest'){if(mime!=='application/json'||blob.size>MAX_METADATA)throw Error('El manifiesto excede el límite de tamaño o tipo');}
      else if(!MEDIA.test(mime))throw Error('Tipo de medio no permitido');
      const r=rangeFor(range,blob.size),h={'Content-Type':mime,'Content-Length':String(r.end-r.start),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
      if(r.status===206)h['Content-Range']='bytes '+r.start+'-'+(r.end-1)+'/'+blob.size;
      if(r.status===416)h['Content-Range']='bytes */'+blob.size;
      return {...r,headers:h};
    }
    async function request(m){
      if(!idOK(m.id)||requests.has(m.id)||typeof m.asset!=='string'||m.asset.length>128||(m.range!=null&&(typeof m.range!=='string'||m.range.length>160))){close('Solicitud de medio inválida');return;}
      if(requests.size>=MAX_REQUESTS){send({op:'error',id:m.id,message:'Demasiadas solicitudes simultáneas'});return;}
      if(!options.assets?.has(m.asset)){send({op:'error',id:m.id,message:'Recurso no disponible'});return;}
      const r={id:m.id,asset:m.asset,cancelled:false,busy:false};requests.set(r.id,r);
      try{const blob=await options.assets.get(m.asset).getBlob();if(closed||r.cancelled)return;const h=headers(blob,m.asset,m.range);Object.assign(r,{blob,position:h.start,end:h.end});send({op:'headers',id:r.id,status:h.status,headers:h.headers});}
      catch{fail(r,'Archivo no disponible, tipo no permitido o límite de tamaño excedido');}
    }
    async function pull(r){
      if(r.busy){fail(r,'Solicitud de lectura duplicada');return;}
      if(!r.blob){fail(r,'Archivo todavía no disponible');return;}
      r.busy=true;
      try{
        if(r.position>=r.end){send({op:'end',id:r.id});release(r);return;}
        const end=Math.min(r.end,r.position+Math.min(MAX_CHUNK,frameSize-4));
        // Capacity is checked before reading, and again after the bounded slice resolves.
        if(!await writable(end-r.position+4,r))return;
        const chunk=await r.blob.slice(r.position,end).arrayBuffer();
        if(closed||r.cancelled)return;
        if(chunk.byteLength!==end-r.position)throw Error('Lectura incompleta');
        if(!await writable(chunk.byteLength+4,r))return;
        const frame=new Uint8Array(chunk.byteLength+4);new DataView(frame.buffer).setUint32(0,r.id);frame.set(new Uint8Array(chunk),4);send(frame.buffer);r.position=end;r.busy=false;try{options.onProgress?.({asset:r.asset,bytes:chunk.byteLength});}catch{}
      }catch{fail(r,'No se pudo leer el archivo compartido');}
    }
    function receiveHeaders(r,m){
      const h=m.headers,length=Number(h?.['Content-Length']),mime=h?.['Content-Type'];
      if(r.headers||![200,206,416].includes(m.status)||!h||!Number.isSafeInteger(length)||length<0||!(r.asset==='manifest'?mime==='application/json'&&length<=MAX_METADATA:MEDIA.test(mime))){fail(r,'Cabecera de medio inválida');return;}
      if((m.status===416&&length!==0)||(m.status===206&&!/^bytes \d+-\d+\/\d+$/.test(h['Content-Range']||''))){fail(r,'Rango de medio inválido');return;}
      r.headers=true;r.remaining=length;r.port.postMessage({op:'headers',status:m.status,headers:h});
      if(r.earlyPull){r.earlyPull=false;r.pending=true;send({op:'pull',id:r.id});}
    }
    function message(event){
      if(closed)return;
      try{
        const data=event.data;
        if(typeof data!=='string'){
          if(host||!(data instanceof ArrayBuffer)||data.byteLength<5||data.byteLength>frameSize)throw Error('Bloque inválido');
          const id=new DataView(data).getUint32(0),r=requests.get(id);if(!r)return;
          const chunk=data.slice(4);if(!r.headers||!r.pending||chunk.byteLength>r.remaining)throw Error('Bloque fuera de rango');
          r.pending=false;r.remaining-=chunk.byteLength;r.port.postMessage({op:'chunk',chunk},[chunk]);try{options.onProgress?.({asset:r.asset,bytes:data.byteLength-4});}catch{}return;
        }
        if(data.length>8192)throw Error('Mensaje demasiado grande');const m=JSON.parse(data);
        if(!m||typeof m!=='object')throw Error('Mensaje inválido');
        if(m.op==='hello'){if(!Number.isInteger(m.maxMessageSize)||m.maxMessageSize<256)throw Error('Límite inválido');frameSize=Math.min(frameSize,m.maxMessageSize);return;}
        if(m.op==='close'){close(undefined,false);return;}
        if(!idOK(m.id))throw Error('Solicitud inválida');
        if(host&&m.op==='request'){void request(m);return;}
        const r=requests.get(m.id);if(!r)return;
        if(host){if(m.op==='cancel')release(r);else if(m.op==='pull')void pull(r);else throw Error('Operación inválida');}
        else if(m.op==='headers')receiveHeaders(r,m);
        else if(m.op==='error')fail(r,'No se pudo obtener el medio compartido: '+String(m.message||'Error').slice(0,160));
        else if(m.op==='end'){if(!r.headers||r.remaining!==0)throw Error('Lectura incompleta');r.port.postMessage({op:'end'});release(r);}
        else throw Error('Operación inválida');
      }catch{close('Protocolo de medios inválido');}
    }
    listen('message',message);listen('close',()=>close(undefined,false));listen('error',()=>close('Se perdió la conexión',false));
    send({op:'hello',maxMessageSize:localFrame});
    function pipe(asset,range,port){
      if(!port||typeof port.postMessage!=='function')throw Error('Falta el puerto de medios');
      if(closed||requests.size>=MAX_REQUESTS||typeof asset!=='string'||asset.length>128){port.postMessage({op:'error',message:closed?'La sesión compartida terminó':'Demasiadas solicitudes o recurso inválido'});port.close();return;}
      if(nextId>0xffffffff){close('Límite de solicitudes alcanzado');port.postMessage({op:'error',message:'La sesión compartida terminó'});port.close();return;}
      const r={id:nextId++,asset,port,cancelled:false,pending:false,headers:false,earlyPull:false};requests.set(r.id,r);
      port.onmessage=event=>{
        if(r.cancelled)return;
        const op=event.data?.op;
        if(op==='cancel'){try{send({op:'cancel',id:r.id});}catch{}release(r);}
        else if(op==='pull'&&!r.pending&&!r.earlyPull){if(!r.headers)r.earlyPull=true;else{r.pending=true;try{send({op:'pull',id:r.id});}catch{close();}}}
      };port.start?.();try{send({op:'request',id:r.id,asset,range:range||null});}catch{close();}
    }
    async function fetchBlob(asset,maxBytes=MAX_METADATA){
      if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>MAX_METADATA)throw Error('Límite de tamaño inválido');
      const ports=new MessageChannel(),chunks=[];let size=0,mime='';
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(Error('Tiempo de transferencia agotado')),30000);
        function finish(error){clearTimeout(timer);ports.port1.postMessage({op:'cancel'});ports.port1.close();if(error)reject(error);else resolve(new Blob(chunks,{type:mime}));}
        ports.port1.onmessage=event=>{const m=event.data;
          if(m.op==='error')finish(Error(m.message));
          else if(m.op==='headers'){if(m.status!==200||Number(m.headers['Content-Length'])>maxBytes){finish(Error('El archivo excede el límite de tamaño'));return;}mime=m.headers['Content-Type'];ports.port1.postMessage({op:'pull'});}
          else if(m.op==='chunk'){size+=m.chunk.byteLength;if(size>maxBytes){finish(Error('El archivo excede el límite de tamaño'));return;}chunks.push(m.chunk);ports.port1.postMessage({op:'pull'});}
          else if(m.op==='end')finish();
        };ports.port1.start?.();pipe(asset,null,ports.port2);
      });
    }
    return host?{close:()=>close()}:{pipe,fetchBlob,close:()=>close()};
  }
  const api={serve:(channel,options)=>endpoint(channel,options,true),receive:(channel,options)=>endpoint(channel,options,false)};
  root.AgelShareTransfer=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
