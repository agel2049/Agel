/* Filter-only view of the showroom's personal GLB. No model/version writes. */
(function(root){
 'use strict';const {h,field,formatBytes}=AgelDOM;
 async function mount(app,{cloud,projectId,returnUrl}){
  if(!cloud.user)throw Error('Inicia sesión con la cuenta que guardó este GLB.');
  const owner=cloud.user.id,workspace=await AgelWorkspace.open({cloud,ownerId:owner,projectId}),draft=await workspace.load(),model=draft.showroom.model3d;
  if(!model?.url){workspace.close();throw Error('Este proyecto no tiene GLB. Agrégalo en Showroom → Modelo 3D.');}
  let view,closed=false;const filters={facets:{},query:'',preset:'all'};
  const close=()=>{if(closed)return;closed=true;view?.dispose();workspace.close();unsubscribe?.();root.removeEventListener('storage',storage);};
  const accountChanged=()=>{if(cloud.user?.id!==owner){close();app.replaceChildren(h('main',{class:'bm-msg'},h('h1',null,'La cuenta cambió'),h('p',null,'Vuelve a abrir el modelo desde el panel con su cuenta.')));}};
  const unsubscribe=cloud.onAuth?.(accountChanged);
  const storage=ev=>{if(ev.key===(cloud.storageKey||'agel.session')){try{if(JSON.parse(ev.newValue||'null')?.user?.id===owner)return;}catch{}close();app.replaceChildren(h('main',{class:'bm-msg'},h('h1',null,'Sesión cambiada'),h('p',null,'Vuelve a abrir el modelo con su cuenta.')));}};
  root.addEventListener('storage',storage);root.addEventListener('pagehide',close,{once:true});root.addEventListener('pageshow',ev=>{if(ev.persisted)location.reload();},{once:true});
  document.body.classList.add('bm-local');
  const stage=h('div',{class:'bm-local-stage'}),status=h('p',{role:'status',class:'bm-muted'},'Cargando GLB del dispositivo…'),error=h('p',{role:'alert',class:'ag-error'});
  const panel=h('aside',{class:'bm-local-panel',id:'bm-local-filters'},h('h2',null,'Filtros'),status,error),toggle=h('button',{type:'button',class:'ag-btn','aria-expanded':'true','aria-controls':'bm-local-filters',onclick:()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));}},'Filtros');
  panel.hidden=matchMedia('(max-width:700px)').matches;toggle.setAttribute('aria-expanded',String(!panel.hidden));
  const back=AgelBimPresets.safeReturn(returnUrl,location.href);
  app.replaceChildren(stage,h('header',{class:'bm-local-top'},h('a',{class:'ag-btn',href:back||`../panel/#/p/${projectId}/showroom`},back?'Volver al showroom':'Volver al panel'),h('h1',null,model.title||draft.tree.project.name),h('span',{class:'bm-grow'}),toggle),panel);
  try{
   let blob;
   if(model.url.startsWith('agel-local:'))blob=(await workspace.store.get(model.url)).blob;
   else{
    if(!/^https:\/\//i.test(model.url)||!safeMediaUrl(model.url)||! /\.glb(\?|$)/i.test(model.url))throw Error('La dirección del modelo no es un GLB HTTPS válido.');
    const response=await fetch(model.url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('No se pudo descargar el GLB existente.');blob=await response.blob();
   }
   if(closed||cloud.user?.id!==owner){close();return;}
   view=await AgelGLB.open(stage,{blob});if(closed||cloud.user?.id!==owner){view.dispose();close();return;}
   const elements=view.elements,facets=AgelGLBFilters.facets(elements),presetButtons=[];
   const apply=()=>{const visible=view.filter(filters);status.textContent=`${visible.length} de ${elements.length} piezas · ${formatBytes(blob.size)} · vista local`;for(const [id,b]of presetButtons)b.setAttribute('aria-pressed',String(filters.preset===id));};
   const search=h('input',{type:'search',placeholder:'Nombre, grupo o material','aria-label':'Buscar piezas',oninput:ev=>{filters.query=ev.target.value;apply();}});
   const presets=h('div',{class:'bm-local-presets'});
   for(const[id,label]of [['all','Todo'],['mep','Instalaciones'],['masonry','Albañilería'],['structure','Estructura'],['finishes','Acabados']]){
    const count=AgelGLBFilters.select(elements,{preset:id}).length,b=h('button',{type:'button',class:'ag-btn',disabled:!count,'aria-pressed':String(id==='all'),onclick:()=>{filters.preset=id;apply();view.fit();}},`${label} (${count})`);presetButtons.push([id,b]);presets.append(b);
   }
   const reset=h('button',{class:'ag-btn',type:'button',onclick:()=>{filters.facets={};filters.query='';filters.preset='all';search.value='';for(const i of panel.querySelectorAll('input[type=checkbox]'))i.checked=false;apply();view.fit();}},'Ver todo');
   panel.append(h('p',{class:'bm-muted'},'Gira arrastrando. Acerca con la rueda o con dos dedos.'),field('Buscar piezas',search),presets,h('div',{class:'bm-row'},reset,h('button',{class:'ag-btn',type:'button',onclick:()=>view.fit()},'Encuadrar visibles')));
   const labels={discipline:'Instalación o disciplina',category:'Categoría',level:'Nivel',group:'Grupo del modelo',material:'Material'};
   for(const f of AgelGLBFilters.fields){
    const values=Object.entries(facets[f]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'es',{numeric:true})),list=h('div',{class:'bm-local-values'});
    for(const[value,count]of values.slice(0,150)){const check=h('input',{type:'checkbox',onchange:ev=>{const selected=new Set(filters.facets[f]||[]);ev.target.checked?selected.add(value):selected.delete(value);filters.facets[f]=[...selected];apply();}});list.append(h('label',null,check,h('span',null,value),h('small',null,count)));}
    panel.append(h('details',{class:'bm-facet',open:f==='discipline'},h('summary',null,labels[f]),list,values.length>150?h('p',{class:'bm-muted'},'Mostrando los 150 valores más frecuentes. Usa la búsqueda para encontrar las demás piezas.'):null));
   }
   if(elements.length===1)panel.append(h('p',{class:'bm-muted'},'El archivo contiene una sola pieza. Para separar instalaciones, exporta conservando los objetos y sus nombres.'));
   if(elements.some(e=>e.source!=='properties'))panel.append(h('p',{class:'bm-muted'},'Las piezas sin propiedades BIM se agrupan por sus nombres y materiales. Las clasificaciones por nombre son orientativas.'));
   apply();
  }catch(e){if(!closed){view?.dispose();status.textContent='';error.textContent=e.message;}}
  return {close};
 }
 root.AgelLocalGLB={mount};
})(window);
