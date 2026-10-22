/* Temporary sharing is an in-memory, single-receiver view of the saved local draft. */
(function(root){
 'use strict';
 let active;
 function qr(link){
  const code=qrcodegen.QrCode.encodeText(link,qrcodegen.QrCode.Ecc.MEDIUM),border=4;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox',`0 0 ${code.size+border*2} ${code.size+border*2}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Código QR del showroom temporal');svg.style.cssText='display:block;width:min(100%,264px);height:auto;background:white;border:12px solid white;border-radius:8px;margin:16px auto;shape-rendering:crispEdges';
  let d='';for(let y=0;y<code.size;y++)for(let x=0;x<code.size;x++)if(code.getModule(x,y))d+=`M${x+border},${y+border}h1v1h-1z`;
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);path.setAttribute('fill','#111');svg.append(path);return svg;
 }
 async function open({workspace,rootUrl}){
  active?.close();
  const {h,modal}=AgelDOM,owner=workspace.cloud.user?.id;
  if(!owner||owner!==workspace.ownerId)throw Error('Inicia sesión con la cuenta del proyecto.');
  if(!root.isSecureContext||!root.RTCPeerConnection)throw Error('Abre AgelArq con HTTPS en un navegador compatible para compartir.');
  let closed=false,peer,transfer,expireTimer,unAuth,unWorkspace,modelHost,dataChannel,modelListener,packageClose;
  const status=h('p',{role:'status','aria-live':'polite'},'Preparando conexión privada…'),qrHost=h('div'),linkField=h('input',{readonly:true,'aria-label':'Enlace temporal',style:'width:100%;box-sizing:border-box',hidden:true});
  const copy=h('button',{type:'button',class:'ag-btn',disabled:true,onclick:async()=>{try{await navigator.clipboard.writeText(linkField.value);status.textContent='Enlace copiado. Ábrelo en el otro dispositivo.';}catch{linkField.focus();linkField.select();status.textContent='Selecciona y copia el enlace.';}}},'Copiar enlace');
  const panel=modal({title:'Compartir temporalmente',body:[h('p',null,'Abre este showroom en un celular con una cuenta del proyecto. Sesión de 30 minutos para un receptor.'),h('p',{class:'pn-muted'},'Cuenta: '+(workspace.cloud.user?.email||'cuenta del proyecto')),h('p',{class:'pn-muted'},'Se usa el último borrador guardado. Guarda tus cambios antes de compartir. Mantén esta pestaña abierta.'),qrHost,status,h('div',{class:'ag-field'},linkField),copy],actions:[{label:'Finalizar',onClick:()=>session.close()}],onClose:()=>close('Sesión finalizada')});
  function close(message='Sesión finalizada'){
   if(closed)return;closed=true;clearTimeout(expireTimer);if(modelListener)dataChannel?.removeEventListener('message',modelListener);modelHost?.close();packageClose?.();transfer?.close();peer?.close();unAuth?.();unWorkspace?.();
   root.removeEventListener('pagehide',onPage);root.removeEventListener('hashchange',onProject);root.removeEventListener('storage',onStorage);
   qrHost.replaceChildren();linkField.value='';linkField.hidden=true;copy.disabled=true;status.textContent=message;if(active===session)active=null;
  }
  const onPage=()=>close(),onProject=()=>{close('El proyecto cambió. Abre una nueva sesión.');panel.close();},onStorage=e=>{if(e.key!==null&&e.key!==workspace.cloud.storageKey)return;try{if(JSON.parse(e.newValue||'null')?.user?.id===owner)return;}catch{}close('La cuenta o sesión cambió. Vuelve a compartir.');};
  const session={close(){close();panel.close();},get link(){return closed?'':linkField.value;}};active=session;
  root.addEventListener('pagehide',onPage,{once:true});root.addEventListener('hashchange',onProject);root.addEventListener('storage',onStorage);
  unAuth=workspace.cloud.onAuth(()=>{if(workspace.cloud.user?.id!==owner)close('La cuenta cambió. Vuelve a compartir.');});unWorkspace=workspace.onClose?.(()=>close('El proyecto cambió. Vuelve a compartir.'));
  try{
   const {snapshot,assets,remoteModel,close:releasePackage}=await workspace.sharePackage();packageClose=releasePackage;if(closed){packageClose?.();return session;}
   const expiresAt=Date.now()+30*60*1000,sessionId=crypto.randomUUID(),bytes=crypto.getRandomValues(new Uint8Array(32)),key=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const json=JSON.stringify({snapshot,expiresAt,remoteModel});if(new TextEncoder().encode(json).length>4*1024*1024)throw Error('El showroom tiene demasiados metadatos para compartir. Reduce textos o vistas.');
   const manifest=new Blob([json],{type:'application/json'});assets.set('manifest',{getBlob:async()=>manifest});
   const base=rootUrl||new URL('../../',location.href).href,url=new URL('apps/share/',base);url.hash=new URLSearchParams({project:workspace.projectId,session:sessionId,key,expires:String(expiresAt)}).toString();
   expireTimer=setTimeout(()=>close('Sesión expirada. Abre una nueva para continuar.'),expiresAt-Date.now());
   if(remoteModel){const renderer=h('div',{'aria-hidden':'true',style:'position:fixed;left:-12000px;top:0;width:960px;height:640px;overflow:hidden;pointer-events:none'});panel.el.append(renderer);modelHost=AgelSharedModel.host({workspace,container:renderer,sessionId,send:message=>{if(!closed&&dataChannel?.readyState==='open')dataChannel.send(JSON.stringify(message));}});}
   peer=AgelSharePeer.host({stream:modelHost?.stream,cloud:workspace.cloud,projectId:workspace.projectId,sessionId,key,expiresAt,
    onChannel:channel=>{if(closed){channel.close();return;}dataChannel=channel;modelListener=event=>{if(typeof event.data!=='string'||event.data.length>8192)return;try{const m=JSON.parse(event.data);if(m.op==='model')modelHost?.handle(m);}catch{}};channel.addEventListener('message',modelListener);transfer=AgelShareTransfer.serve(channel,{assets,onClose:()=>close('El receptor se desconectó. Abre una nueva sesión para compartir.')});status.textContent='Celular conectado · sesión de solo lectura';},
    onState:e=>{if(closed)return;if(e.state==='closed'||e.state==='error'){close(e.message||'No se pudo conectar. Usa la misma red en ambos dispositivos y vuelve a compartir.');}else status.textContent=e.message||'Esperando al celular…';}});
   peer.ready.catch(e=>close(e.message));if(closed)return session;
   qrHost.replaceChildren(qr(url.href));linkField.value=url.href;linkField.hidden=false;copy.disabled=false;status.textContent='Escanea el QR. En el celular, inicia sesión con una cuenta del proyecto.';
  }catch(e){close(e.message||'No se pudo iniciar la sesión. Vuelve a intentar.');}
  return session;
 }
 root.AgelTemporaryShare={open,close:()=>active?.close()};
})(window);
