/* Filter-only view of the showroom's personal GLB. No model/version writes. */
(function(root){
 'use strict';const {h}=AgelDOM;
 async function mount(app,{cloud,projectId,returnUrl}){
  if(!cloud.user)throw Error('Inicia sesión con la cuenta que guardó este GLB.');
  const owner=cloud.user.id,workspace=await AgelWorkspace.open({cloud,ownerId:owner,projectId}),draft=await workspace.load(),model=draft.showroom.model3d;
  if(!model?.url){workspace.close();throw Error('Este proyecto no tiene GLB. Agrégalo en Showroom → Modelo 3D.');}
  let pane,closed=false;
  const close=()=>{if(closed)return;closed=true;pane?.dispose();workspace.close();unsubscribe?.();root.removeEventListener('storage',storage);};
  const accountChanged=()=>{if(cloud.user?.id!==owner){close();app.replaceChildren(h('main',{class:'bm-msg'},h('h1',null,'La cuenta cambió'),h('p',null,'Vuelve a abrir el modelo desde el panel con su cuenta.')));}};
  const unsubscribe=cloud.onAuth?.(accountChanged);
  const storage=ev=>{if(ev.key===(cloud.storageKey||'agel.session')){try{if(JSON.parse(ev.newValue||'null')?.user?.id===owner)return;}catch{}close();app.replaceChildren(h('main',{class:'bm-msg'},h('h1',null,'Sesión cambiada'),h('p',null,'Vuelve a abrir el modelo con su cuenta.')));}};
  root.addEventListener('storage',storage);root.addEventListener('pagehide',close,{once:true});root.addEventListener('pageshow',ev=>{if(ev.persisted)location.reload();},{once:true});
  document.body.classList.add('bm-local');
  const back=AgelBimPresets.safeReturn(returnUrl,location.href);
  const backUrl=back||`../panel/#/p/${projectId}/showroom`;
  app.replaceChildren(h('main',{class:'bm-msg'},h('h1',null,model.title||'Maqueta virtual'),h('p',{role:'status'},'Cargando GLB del dispositivo…')));
  try{
   let blob;
   if(model.url.startsWith('agel-local:'))blob=(await workspace.store.get(model.url)).blob;
   else{
    if(!/^https:\/\//i.test(model.url)||!safeMediaUrl(model.url)||! /\.glb(\?|$)/i.test(model.url))throw Error('La dirección del modelo no es un GLB HTTPS válido.');
    const response=await fetch(model.url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('No se pudo descargar el GLB existente.');blob=await response.blob();
   }
   if(closed||cloud.user?.id!==owner){close();return;}
   pane=AgelMaquette.mount(app,{blob,title:model.title||draft.tree.project.name,backUrl,backLabel:back?'Volver al showroom':'Volver al panel'});
   app.querySelector('.bm-msg')?.remove();await pane.ready;
  }catch(e){if(!closed&&!pane)app.replaceChildren(h('main',{class:'bm-msg'},h('h1',null,'No se pudo abrir la maqueta'),h('p',{role:'alert'},e.message),h('a',{href:backUrl,class:'ag-btn'},'Volver al panel')));}

  return {close};
 }
 root.AgelLocalGLB={mount};
})(window);
