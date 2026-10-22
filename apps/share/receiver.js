/* Receiver state stays in memory. Only the current authenticated account is used. */
(function(root){
 'use strict';
 const gate=document.getElementById('share-gate'),status=document.getElementById('share-status'),form=document.getElementById('share-login'),banner=document.getElementById('share-banner');
 const listeners=new Set();let resolveReady,rejectReady,closed=false,connected=false,peer,receive,timer,unAuth,cloud,owner,bound=false,modelStream,remoteModel,modelMount,modelDialog,modelListener,dataChannel,latestModelState,workerCancel;
 const ready=new Promise((res,rej)=>{resolveReady=res;rejectReady=rej;});ready.catch(()=>{});
 root.AgelTemporarySession={ready,openModel,onClose(fn){if(closed){fn();return()=>{};}listeners.add(fn);return()=>listeners.delete(fn);},close:()=>close('Saliste del showroom. Solicita un nuevo enlace para volver a entrar.')};
 const params=new URLSearchParams(location.hash.slice(1)),projectId=params.get('project'),sessionId=params.get('session'),key=params.get('key'),expiresAt=Number(params.get('expires'));
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 function close(message='La sesión finalizó. Solicita un nuevo enlace al equipo que comparte.'){
  if(closed)return;closed=true;clearTimeout(timer);workerCancel?.();closeModel();if(modelListener)dataChannel?.removeEventListener('message',modelListener);receive?.close();peer?.close();unAuth?.();
  if(bound)navigator.serviceWorker.controller?.postMessage({type:'agel-share-unbind',session:sessionId});bound=false;
  navigator.serviceWorker?.removeEventListener('message',onMedia);root.removeEventListener('pagehide',onPage);root.removeEventListener('storage',onStorage);root.removeEventListener('hashchange',onLink);
  for(const fn of listeners){try{fn();}catch{}}listeners.clear();
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelectorAll('video,audio').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});
  modelStream?.getTracks().forEach(t=>t.stop());modelStream=null;document.getElementById('sr-app').replaceChildren();banner.hidden=true;gate.hidden=false;form.hidden=true;status.textContent=message;rejectReady(Error(message));
  history.replaceState(null,'',location.pathname+location.search);
 }
 function onLink(){
  const next=new URLSearchParams(location.hash.slice(1));
  // Showroom anchors replace the fragment; the authenticated QR stays in memory.
  if(!['project','session','key','expires'].some(name=>next.has(name)))return;
  if(next.get('project')?.toLowerCase()!==projectId.toLowerCase()||next.get('session')?.toLowerCase()!==sessionId.toLowerCase()||next.get('key')!==key||Number(next.get('expires'))!==expiresAt)close('El enlace cambió. Solicita un nuevo QR.');
 }
 const onPage=()=>close();
 function onStorage(e){
  if(e.key!==null&&e.key!==(cloud?.storageKey||'agel.session'))return;
  try{if(JSON.parse(e.newValue||'null')?.user?.id===owner)return;}catch{}
  close('La cuenta o sesión cambió. Solicita un nuevo enlace.');
 }
 function onMedia(event){
  const data=event.data,port=event.ports?.[0];
  if(!port)return;
  if(event.source===navigator.serviceWorker.controller&&data?.type==='agel-share-probe'){port.postMessage({active:!closed&&!!receive&&data.session===sessionId});port.close();return;}
  if(closed||!receive||event.source!==navigator.serviceWorker.controller||data?.type!=='agel-share-fetch'||data.session!==sessionId){port.postMessage({op:'error',message:'Sesión no disponible'});port.close();return;}
  receive.pipe(data.asset,data.range,port);
 }
 async function worker(){
  if(!navigator.serviceWorker)throw Error('Este navegador no permite la conexión temporal. Usa un navegador actualizado con HTTPS.');
  await navigator.serviceWorker.register('media-worker.js',{scope:'./'});
  await navigator.serviceWorker.ready;
  const workerUrl=new URL('media-worker.js',location.href).href;
  if(navigator.serviceWorker.controller?.scriptURL!==workerUrl)await new Promise((resolve,reject)=>{
   const finish=error=>{clearTimeout(timeout);navigator.serviceWorker.removeEventListener('controllerchange',change);workerCancel=null;error?reject(error):resolve();};
   const timeout=setTimeout(()=>finish(Error('No se pudo preparar la conexión. Recarga y vuelve a intentar.')),10000);
   function change(){if(navigator.serviceWorker.controller?.scriptURL===workerUrl)finish();}
   workerCancel=()=>finish(Error('Sesión finalizada'));navigator.serviceWorker.addEventListener('controllerchange',change);change();
  });
  if(closed)throw Error('Sesión finalizada');
  navigator.serviceWorker.addEventListener('message',onMedia);navigator.serviceWorker.controller.postMessage({type:'agel-share-bind',session:sessionId});bound=true;
 }
 function remap(model){
  const placeholder=/^https:\/\/agel-share\.invalid\/([0-9a-f-]{36})\.(jpg|jpeg|png|webp|avif|gif|mp4|webm|glb|pdf)$/i;
  function walk(v){
   if(typeof v==='string'&&v.startsWith('https://agel-share.invalid/')){const m=placeholder.exec(v);if(!m||!uuid.test(m[1]))throw Error('Referencia de archivo no válida');return new URL(`media/${sessionId}/${m[1]}.${m[2].toLowerCase()}`,location.href).href;}
   if(Array.isArray(v))return v.map(walk);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)]));return v;
  }return walk(model);
 }
 function closeModel(){modelMount?.dispose();modelMount=null;modelDialog?.remove();modelDialog=null;}
 function sendModel(message){if(!closed&&dataChannel?.readyState==='open')dataChannel.send(JSON.stringify(message));}
 function openModel(){
  if(closed||!remoteModel||modelDialog)return;
  const dialog=document.createElement('dialog');dialog.className='mq-dialog';dialog.setAttribute('aria-label','Maqueta transmitida');
  modelDialog=dialog;document.body.append(dialog);dialog.addEventListener('close',closeModel,{once:true});
  if(!modelStream){const p=document.createElement('p');p.textContent='La imagen 3D aún no está disponible. Cierra y vuelve a intentar.';const button=document.createElement('button');button.textContent='Cerrar';button.onclick=()=>dialog.close();dialog.append(p,button);}
  else{modelMount=AgelSharedModel.mount(dialog,{stream:modelStream,send:sendModel,title:remoteModel.title,onClose:()=>dialog.close()});if(latestModelState)modelMount.handle(latestModelState);}
  dialog.showModal();
 }
 async function connect(){
  if(closed||connected)return;connected=true;owner=cloud.user?.id;if(!owner){connected=false;throw Error('Inicia sesión con una cuenta del proyecto.');}
  form.hidden=true;status.textContent='Conectando con el equipo que comparte…';
  unAuth=cloud.onAuth(()=>{if(cloud.user?.id!==owner)close('La cuenta cambió. Solicita un nuevo enlace.');});
  root.addEventListener('pagehide',onPage,{once:true});root.addEventListener('storage',onStorage);
  try{
   await worker();if(closed)return;
   peer=AgelSharePeer.guest({cloud,projectId,sessionId,key,expiresAt,onTrack:stream=>{if(closed){stream.getTracks().forEach(t=>t.stop());return;}modelStream=stream;},onState:e=>{if(closed)return;if(e.state==='closed'||e.state==='error')close(e.message||'No se pudo conectar. Usa la misma red en ambos dispositivos y solicita otro enlace.');else status.textContent=e.message||'Conectando…';},onChannel:async channel=>{
    if(closed){channel.close();return;}
    dataChannel=channel;modelListener=event=>{if(typeof event.data!=='string'||event.data.length>8192)return;try{const m=JSON.parse(event.data);if(m.op==='model-state'){latestModelState=m;modelMount?.handle(m);}}catch{}};channel.addEventListener('message',modelListener);
    receive=AgelShareTransfer.receive(channel,{onClose:()=>close()});
    try{
     const blob=await receive.fetchBlob('manifest',4*1024*1024);if(closed)return;
     const manifest=JSON.parse(await blob.text());if(!Number.isSafeInteger(manifest.expiresAt)||manifest.expiresAt>Date.now()+30*60*1000||manifest.expiresAt>expiresAt||manifest.expiresAt<=Date.now())throw Error('La sesión ya expiró. Solicita otro enlace.');
     // Validation must precede trusted same-origin Service Worker URLs.
     const model=remap(sanitizeShowroom(manifest.snapshot));model.content.model3d=null;
     if(manifest.remoteModel?.available===true){remoteModel={available:true,title:typeof manifest.remoteModel.title==='string'?manifest.remoteModel.title.slice(0,120):'Maqueta virtual'};model.content.model3d={url:'https://agel-shared-model.invalid/remote.glb',title:remoteModel.title,poster:null};}if(closed)return;
     document.getElementById('share-identity').textContent=cloud.user.email||'Cuenta del proyecto';gate.hidden=true;banner.hidden=false;resolveReady(model);
    }catch(e){close(e.message||'No se pudo cargar el showroom. Solicita un nuevo enlace.');}
   }});
   await peer.ready;
  }catch(e){close(e.message||'No se pudo conectar. Usa la misma red en ambos dispositivos y solicita un nuevo enlace.');}
 }
 form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{await cloud.signInWithPassword(document.getElementById('share-email').value,document.getElementById('share-password').value);document.getElementById('share-password').value='';await connect();}
  catch(e){status.textContent=e.message||'No se pudo iniciar sesión. Vuelve a intentar.';}finally{button.disabled=false;}
 });
 document.getElementById('share-leave').onclick=()=>close('Saliste del showroom. Solicita un nuevo enlace para volver a entrar.');
 async function init(){try{
  if(!root.isSecureContext||!root.RTCPeerConnection)throw Error('Abre este enlace con HTTPS en un navegador actualizado.');
  if(!uuid.test(projectId||'')||!uuid.test(sessionId||'')||!/^[A-Za-z0-9_-]{43}$/.test(key||'')||!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+30*60*1000)throw Error('Este enlace venció o no es válido. Solicita un nuevo QR.');
  timer=setTimeout(()=>close('La sesión expiró. Solicita un nuevo QR.'),expiresAt-Date.now());root.addEventListener('hashchange',onLink);cloud=AgelCloud.client();
  if(cloud.user)await connect();else{form.hidden=false;status.textContent='Inicia sesión para acceder al proyecto.';}
 }catch(e){close(e.message);}}
 init();
})(window);
