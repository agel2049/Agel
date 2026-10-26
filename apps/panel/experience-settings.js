(function(root){
 'use strict';const {h,field}=AgelDOM;
 async function mount(container,{workspace,onChange=()=>{},views:providedViews,editSession:providedSession}){
  const d=await workspace.load(),sr=d.showroom,e=sr.experience||{},o=sr.opening||{};let views=providedViews||structuredClone(sr.views||[]),privateSettings=structuredClone(d.privateSettings||{});
  const editSession=providedSession||{revision:d.localRevision};
  const text=(value,max=160)=>h('input',{value:value||'',maxlength:max}),enabled=h('input',{type:'checkbox',checked:e.version===1}),active=h('input',{type:'checkbox',checked:o.enabled??!!(o.video||o.videoUrl)});
  const video=text(o.video||o.videoUrl,2048),poster=text(o.poster,2048);
  let importing=false,previewSequence=0;const mediaInputs=[],openingPreview=h('div',{class:'pn-opening-preview'});
  const facade=h('select',{'aria-label':'Fachada inicial'}),entry=h('select',{'aria-label':'Planta de entrada'}),x=h('input',{type:'number',min:0,max:100,step:0.1,value:e.entrance?.x??50}),y=h('input',{type:'number',min:0,max:100,step:0.1,value:e.entrance?.y??70}),entranceLabel=text(e.entrance?.label||'Entrar al lobby',80);
  const error=h('p',{role:'alert',class:'ag-error'}),status=h('p',{role:'status',class:'pn-muted'}),preview=h('div',{class:'pn-entry-preview'}),relations=h('div',{class:'pn-grid'});
  async function drawEntry(){preview.replaceChildren();const v=views.find(v=>v.id===facade.value);if(!v)return;try{const img=h('img',{src:await workspace.resolveMedia(v.image),alt:'Colocar entrada en fachada'}),marker=h('span',{class:'pn-entry-dot',style:{left:x.value+'%',top:y.value+'%'}},'↗');
   const stage=h('div',{class:'pn-entry-stage',onclick:ev=>{const p=AgelShowroomGeometry.imagePoint(ev,img.getBoundingClientRect());if(!p)return;x.value=p[0];y.value=p[1];marker.style.left=x.value+'%';marker.style.top=y.value+'%';}},img,marker);preview.append(stage);
  }catch(ex){error.textContent=ex.message;}}
  function refreshViews(next=views){views=next;const f=facade.value||e.facadeViewId,l=entry.value||e.entryTargetViewId;
   for(const sel of [facade,entry]){sel.replaceChildren(h('option',{value:''},'Selecciona una vista'),...views.map(v=>h('option',{value:v.id},v.title||v.id)));}facade.value=f||'';entry.value=l||'';
   relations.replaceChildren(...views.map(v=>{const space=h('select',{'aria-label':`Espacio de ${v.title||v.id}`,onchange:ev=>v.spaceId=ev.target.value||null},h('option',{value:''},'Todo el proyecto'),...d.spaces.map(s=>h('option',{value:s.id,selected:s.id===v.spaceId},s.name)));
    const role=h('select',{'aria-label':`Uso de ${v.title||v.id}`,onchange:ev=>v.role=ev.target.value},...[['facade','Fachada'],['lobby','Lobby'],['floor','Planta de nivel'],['unit','Planta de unidad']].map(([id,label])=>h('option',{value:id,selected:(v.role||'facade')===id},label)));
    return h('div',{class:'pn-note'},h('strong',null,v.title||v.id),field('Espacio asociado',space),field('Uso de la vista',role));}));drawEntry();
  }
  facade.onchange=drawEntry;x.oninput=drawEntry;y.oninput=drawEntry;
  async function drawOpening(){
   const seq=++previewSequence,old=openingPreview.querySelector('video');if(old){old.pause();old.removeAttribute('src');old.load();}openingPreview.replaceChildren();if(!video.value)return;
   try{const url=await workspace.resolveMedia(video.value.trim());if(seq!==previewSequence)return;
    const player=h('video',{src:url,controls:true,preload:'metadata',playsinline:true,'aria-label':'Vista previa del video local'});
    player.onerror=()=>{if(seq===previewSequence)error.textContent='Este navegador no puede reproducir el video. Prueba MP4 con H.264 o WebM; el original sigue guardado en este dispositivo.';};
    openingPreview.append(player,h('button',{type:'button',class:'ag-btn',onclick:()=>storeOpening('video','').catch(ex=>error.textContent=ex.message)},'Quitar video del Opening'));
   }catch(ex){if(seq===previewSequence)error.textContent=ex.message;}
  }
  async function storeOpening(key,ref,{fromImport=false}={}){
   if(importing&&!fromImport)throw Error('Espera a que termine de guardarse el archivo local.');
   const fresh=await workspace.load();if(fresh.localRevision!==editSession.revision)throw Error('Hay cambios de otra pestaña. Recarga antes de guardar.');
   fresh.showroom.opening={...fresh.showroom.opening,[key]:ref,...(key==='video'?{enabled:!!ref}:{}),button:'Iniciar'};
   if(key==='video')delete fresh.showroom.opening.videoUrl;
   await workspace.save(fresh);editSession.revision=fresh.localRevision;onChange({showroom:{opening:fresh.showroom.opening}});
   if(key==='video'){video.value=ref;active.checked=!!ref;await drawOpening();}else poster.value=ref;
   status.textContent=ref?'Opening guardado en este dispositivo · sin subir a la nube':'Video retirado del Opening · el original local se conserva';
  }
  async function fileControl(label,accept,kind,target){
   const fi=h('input',{type:'file',accept,'aria-label':label});mediaInputs.push(fi);
   fi.onchange=async()=>{const file=fi.files[0];if(!file||importing)return;error.textContent='';importing=true;mediaInputs.forEach(i=>i.disabled=true);save.disabled=true;status.textContent=`Guardando ${file.name} en este dispositivo…`;
    try{const meta=await workspace.addMedia(file,kind,{expectedRevision:editSession.revision});editSession.revision=meta.localRevision;
     await storeOpening(target===video?'video':'poster',meta.ref,{fromImport:true});
    }catch(ex){error.textContent=ex.message;status.textContent='No se completó el cambio. El Opening anterior se conserva.';}
    finally{importing=false;mediaInputs.forEach(i=>i.disabled=false);save.disabled=false;fi.value='';}
   };return field(label,fi);
  }
  const markerControls=[];const markers=h('div',{class:'pn-grid'});
  for(const sc of d.tree.scenes)for(const hs of sc.hs||[]){const p=hs.payload?.showroomMarker||{},surface=h('select',{'aria-label':`Superficie de ${hs.title}`},...[['flat','Plano'],['floor','Suelo'],['wall','Pared']].map(([id,label])=>h('option',{value:id,selected:(p.surface||'flat')===id},label)));
   const tilt=h('input',{type:'number',min:-75,max:75,value:p.tilt??55}),rotation=h('input',{type:'number',min:-180,max:180,value:p.rotation??0}),scale=h('input',{type:'number',min:.5,max:2,step:.1,value:p.scale??1});
   markerControls.push({sceneId:sc.id,hotspotId:hs.id,surface,tilt,rotation,scale});markers.append(h('div',{class:'pn-note'},h('strong',null,sc.name+' · '+hs.title),field(`Superficie de ${hs.title}`,surface),field(`Inclinación de ${hs.title}`,tilt),field(`Giro de ${hs.title}`,rotation),field(`Escala de ${hs.title}`,scale)));
  }
  const presetControls=[],presetBox=h('div',{class:'pn-grid'});
  for(const [id,label]of [['mep','MEP'],['finishes','Con acabados'],['grey','Obra gris']]){const p=privateSettings.presets?.[id]||root.AgelBimPresets?.defaults[id]||{},disciplines=h('textarea',{rows:3},(p.disciplines||[]).join('\n')),categories=h('textarea',{rows:3},(p.categories||[]).join('\n')),levels=h('textarea',{rows:2},(p.levels||[]).join('\n'));
   presetControls.push({id,disciplines,categories,levels});presetBox.append(h('details',null,h('summary',null,label),field(`Disciplinas de ${label}`,disciplines,'Una por línea, con el nombre del índice BIM.'),field(`Categorías de ${label}`,categories),field(`Niveles de ${label}`,levels)));
  }
  function read(){
   if(importing)throw Error('Espera a que termine de guardarse el archivo local.');
   const savedOpening={...o};delete savedOpening.videoUrl;
   const content={...sr,views,opening:{...savedOpening,enabled:active.checked,video:video.value.trim(),poster:poster.value.trim(),button:'Iniciar'},experience:{version:enabled.checked?1:0,facadeViewId:facade.value||null,entryTargetViewId:entry.value||null,entrance:{x:Number(x.value),y:Number(y.value),label:entranceLabel.value}}};
   const normalized=AgelShowroomRelations.normalizeExperience(content,d.spaces,d.tree.scenes,{publicMode:false});
   privateSettings.presets={complete:{all:true},...Object.fromEntries(presetControls.map(c=>[c.id,Object.fromEntries(['disciplines','categories','levels'].map(k=>[k,c[k].value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)]))]))};
   const markerEdits=markerControls.map(c=>({sceneId:c.sceneId,hotspotId:c.hotspotId,presentation:{surface:c.surface.value,tilt:Math.max(-75,Math.min(75,Number(c.tilt.value))),rotation:Math.max(-180,Math.min(180,Number(c.rotation.value))),scale:Math.max(.5,Math.min(2,Number(c.scale.value)))}}));
   return {showroom:{opening:normalized.opening,experience:normalized.experience,views:normalized.views},privateSettings,markerEdits};
  }
  const bim=h('select',{'aria-label':'Modelo BIM del equipo',onchange:ev=>privateSettings.bimVersionId=ev.target.value||null},h('option',{value:''},'Sin modelo asignado'));
  try{const versions=await workspace.cloud.select('model_versions',`project_id=eq.${workspace.projectId}&select=id,label,source_name,status&order=created_at.desc`);for(const v of versions)bim.append(h('option',{value:v.id,selected:privateSettings.bimVersionId===v.id},`${v.label||v.source_name||v.id} · ${v.status}`));}catch(ex){bim.disabled=true;}
  const save=h('button',{type:'button',class:'ag-btn primary',onclick:async()=>{error.textContent='';try{const next=read(),fresh=await workspace.load();if(fresh.localRevision!==editSession.revision)throw Error('Hay cambios de otra pestaña. Recarga antes de guardar.');Object.assign(fresh.showroom,next.showroom);fresh.privateSettings=next.privateSettings;applyMarkers(fresh,next.markerEdits);await workspace.save(fresh);editSession.revision=fresh.localRevision;onChange(next);status.textContent='Guardado en este dispositivo';}catch(ex){error.textContent=ex.message;}}},'Guardar experiencia en este dispositivo');
  container.append(h('fieldset',null,h('legend',null,'Experiencia del showroom'),h('p',{class:'pn-muted'},'Opening → fachada → planta → unidad → recorrido. Usa Vista previa local para presentar sin subir archivos. Compartir temporalmente abre el showroom en otro dispositivo mientras esta Mac y la pestaña que comparte sigan abiertas.'),
   h('label',{class:'ag-check'},enabled,'Activar showroom inmersivo'),
   h('h3',null,'Opening'),h('p',{class:'pn-muted'},'Video a pantalla completa, logo y un solo botón: Iniciar. Seleccionar un video lo guarda y activa aquí, sin Supabase. El tamaño depende del espacio libre de este navegador, sin el límite de subida de la nube. MP4 (H.264) y WebM ofrecen mayor compatibilidad; MOV depende del navegador.'),h('label',{class:'ag-check'},active,'Activar Opening'),
   await fileControl('Agregar video local','video/*,.mp4,.webm,.mov,.m4v','video',video),openingPreview,await fileControl('Agregar póster local','image/jpeg,image/png,image/webp','image',poster),
   h('details',null,h('summary',null,'Usar video o póster por enlace'),h('div',{class:'pn-grid'},field('Video de presentación (URL HTTPS)',video),field('Póster (URL HTTPS)',poster))),
   h('h3',null,'Fachada y entrada'),h('div',{class:'pn-grid'},field('Fachada inicial',facade),field('Planta de entrada',entry),field('Entrada X (%)',x),field('Entrada Y (%)',y),field('Texto de entrada',entranceLabel)),h('p',{class:'pn-muted'},'Haz clic en la fachada para colocar el acceso.'),preview,
   h('h3',null,'Relaciones de las vistas'),relations,h('h3',null,'Apariencia de hotspots 360°'),h('p',{class:'pn-muted'},'Orientación visual del marcador. Conserva las coordenadas del recorrido.'),markers,h('h3',null,'BIM privado'),field('Modelo BIM del equipo',bim),presetBox,h('p',{class:'pn-muted'},'Solo miembros con acceso al proyecto podrán abrirlo.'),error,status,save));
  refreshViews();drawOpening();return {read,refreshViews};
 }
 function applyMarkers(d,edits){for(const e of edits||[]){const hs=d.tree.scenes.find(s=>s.id===e.sceneId)?.hs.find(h=>h.id===e.hotspotId);if(hs)hs.payload={...hs.payload,showroomMarker:e.presentation};}}
 root.AgelExperienceSettings={mount,applyMarkers};
})(window);
