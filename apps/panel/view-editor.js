/* Area authoring only. Persistence is owned by the caller/workspace. */
(function(root){
 'use strict';
 function open({view,spaces,scenes,views=[],onSave,resolveMedia=ref=>ref}){
  const {h,modal,field,icon}=AgelDOM,G=AgelShowroomGeometry,R=AgelShowroomRelations;
  const work=structuredClone(view);work.regions||=[];work.spots||=[];work.spaceId??=null;
  const w=Number(work.w)||1600,hh=Number(work.h)||900;
  let mode='zone',draft=[],hover=null,orthogonal=false,active=work.regions[0]?.id||null;
  work.regions.forEach((r,i)=>r.id||=(work.id||'view')+'-r'+i);
  active=work.regions[0]?.id||null;
  const option=(value,text,selected=false)=>h('option',{value,selected},text);
  const scope=h('select',{},option('','Todo el proyecto',!work.spaceId),spaces.map(s=>option(s.id,s.name,s.id===work.spaceId)));
  const type=h('select',{},option('render','Render o vista del conjunto',work.kind!=='plano'),option('plano','Plano o planta',work.kind==='plano'));
  const zone=h('select',{},spaces.map(s=>option(s.id,s.name)));
  if(work.spaceId)zone.value=work.spaceId;
  const scene=h('select',{}),targetType=h('select',{},option('space','Ficha o planta del espacio'),option('scene','Escena 360°'),option('view','Otra planta'));
  const target=h('select',{});
  const err=h('p',{class:'ag-error',role:'alert'}),coverage=h('p',{class:'pn-muted'});
  const zoneList=h('ul',{class:'ag-list'}),spotList=h('ul',{class:'ag-list'});
  const round=h('input',{type:'checkbox'}),radius=h('input',{type:'number',min:0,max:2,step:0.1,value:0});
  const toggle=h('button',{type:'button',class:'ag-btn pn-ortho','aria-pressed':'false',title:'Restringir nuevos segmentos a horizontal o vertical. Shift: temporal.',onclick:()=>{orthogonal=!orthogonal;toggle.setAttribute('aria-pressed',String(orthogonal));paint();}},'90°');
  const close=h('button',{type:'button',class:'ag-btn primary',onclick:closeDraft},'Cerrar zona');
  const undo=h('button',{type:'button',class:'ag-btn',onclick:()=>{draft.pop();paint();}},'Deshacer punto');
  const reset=h('button',{type:'button',class:'ag-btn',onclick:()=>{draft=[];paint();}},'Empezar de nuevo');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('pn-vsvg');svg.setAttribute('viewBox',`0 0 ${w} ${hh}`);
  const dots=h('div',{class:'pn-vdots'}),img=h('img',{alt:work.title||'Vista para dibujar'});
  const stage=h('div',{class:'pn-vstage',style:`aspect-ratio:${w}/${hh};--image-ratio:${w/h}`},img,svg,dots);
  Promise.resolve(resolveMedia(work.image)).then(src=>img.src=src).catch(e=>err.textContent=e.message);
  const zoneTools=h('div',{class:'pn-inline'},field('Zona de',zone),field('Destino de la zona',targetType),field('Ir a',target),toggle,close,undo,reset);
  const spotTools=h('div',{class:'pn-inline',hidden:true},field('Escena 360°',scene),h('span',{},'Toca el lugar donde está la cámara.'));
  const modeButtons=['Dibujar zonas','Colocar escenas 360°'].map((label,i)=>h('button',{type:'button',class:'ag-btn','aria-pressed':String(!i),onclick:()=>{
   if(draft.length&&!confirm('Hay una figura sin cerrar. ¿Descartar solo ese dibujo?'))return;
   mode=i?'spot':'zone';draft=[];hover=null;zoneTools.hidden=!!i;spotTools.hidden=!i;
   modeButtons.forEach((b,j)=>b.setAttribute('aria-pressed',String(i===j)));paint();
  }},label));
  const shapeControls=h('div',{class:'pn-inline'},h('label',{class:'ag-check'},round,'Redondear esquinas'),field('Radio de esquinas (%)',radius));
  function allowed(){try{return new Set(R.sceneIdsForScope(work.spaceId,spaces,scenes));}catch(e){err.textContent=e.message;return new Set();}}
  function updateScenes(){const ids=allowed(),chosen=scene.value;
   scene.replaceChildren(...scenes.filter(s=>s.pano_url&&ids.has(s.id)).map(s=>option(s.id,s.name,s.id===chosen)));
   if(!scene.options.length)scene.append(option('','Sin escenas vinculadas a este espacio'));
   updateTargets();paint();
  }
  function updateTargets(){const current=target.value;const list=targetType.value==='scene'?scenes.filter(s=>allowed().has(s.id)&&s.pano_url):targetType.value==='view'?views.filter(v=>v.id!==work.id):spaces;
   target.replaceChildren(...list.map(s=>option(s.id,s.name||s.title,s.id===current)));
   if(targetType.value==='space'&&zone.value)target.value=zone.value;
  }
  function activeRegion(){return work.regions.find(r=>r.id===active);}
  function loadRadius(){const r=activeRegion();radius.value=r?.radius||0;round.checked=Number(radius.value)>0;radius.disabled=!r;round.disabled=!r;}
  function changeRadius(value){const r=activeRegion();if(!r)return;const n=Number(value);if(!Number.isFinite(n)||n<0||n>2){err.textContent='Usa un radio entre 0 y 2 %';return;}r.radius=n;radius.value=n;round.checked=n>0;paint();}
  round.addEventListener('change',()=>changeRadius(round.checked?Number(radius.value)||0.5:0));
  radius.addEventListener('input',()=>changeRadius(radius.value));
  scope.addEventListener('change',()=>{work.spaceId=scope.value||null;updateScenes();});
  targetType.addEventListener('change',updateTargets);zone.addEventListener('change',()=>{updateTargets();paint();});
  stage.addEventListener('pointermove',e=>{const p=G.imagePoint(e,stage.getBoundingClientRect());hover=p&&G.snapPoint(draft.at(-1),p,orthogonal||e.shiftKey);if(draft.length)paint();});
  stage.addEventListener('pointerleave',()=>{hover=null;if(draft.length)paint();});
  stage.addEventListener('click',e=>{
   const p=G.imagePoint(e,stage.getBoundingClientRect());if(!p)return;
   if(mode==='spot'){if(!scene.value)return;work.spots=work.spots.filter(s=>s.scene!==scene.value);work.spots.push({scene:scene.value,x:p[0],y:p[1]});paint();return;}
   const point=G.snapPoint(draft.at(-1),p,orthogonal||e.shiftKey);
   if(draft.length>=3&&Math.hypot(point[0]-draft[0][0],point[1]-draft[0][1])<1.5){closeDraft();return;}
   draft.push(point);paint();
  });
  function closeDraft(){const valid=G.validatePolygon(draft,{w,h:hh});if(!valid.valid){err.textContent=valid.reason;return;}
   if(!zone.value){err.textContent='Crea un espacio en Catálogo antes de dibujar su zona';return;}
   work.regions=work.regions.filter(r=>r.space!==zone.value);
   const r={id:crypto.randomUUID(),space:zone.value,points:draft.map(p=>p.slice()),radius:0,target:{type:targetType.value,id:target.value||zone.value}};
   work.regions.push(r);active=r.id;draft=[];hover=null;loadRadius();paint();
  }
  function paint(){svg.replaceChildren();const ns='http://www.w3.org/2000/svg';
   for(const r of work.regions){try{const path=document.createElementNS(ns,'path');path.setAttribute('d',G.roundedPath(r.points,{w,h:hh,radius:r.radius||0}));path.setAttribute('class','pn-zone'+(r.id===active?' is-current':''));svg.append(path);}catch(e){err.textContent=e.message;}}
   if(draft.length){const line=document.createElementNS(ns,'polyline');line.setAttribute('points',[...draft,...(hover?[hover]:[])].map(([x,y])=>`${x*w/100},${y*hh/100}`).join(' '));line.setAttribute('class','pn-draft');svg.append(line);}
   dots.replaceChildren(...draft.map(([x,y],i)=>h('span',{class:'pn-vpt'+(!i?' is-first':''),style:`left:${x}%;top:${y}%`})),...work.spots.map(sp=>h('span',{class:'pn-vspot',style:`left:${sp.x}%;top:${sp.y}%`,title:scenes.find(s=>s.id===sp.scene)?.name||'Escena ausente'})));
   close.disabled=draft.length<3;undo.disabled=!draft.length;reset.disabled=!draft.length;
   zoneList.replaceChildren(...work.regions.map(r=>h('li',{},h('button',{type:'button',class:'ag-btn',onclick:()=>{active=r.id;loadRadius();paint();}},spaces.find(s=>s.id===r.space)?.name||'Habitación'),
    h('button',{type:'button',class:'ag-btn',onclick:()=>{if(draft.length&&!confirm('¿Descartar el dibujo sin cerrar?'))return;mode='zone';modeButtons[0].click();zone.value=r.space;targetType.value=r.target?.type||'space';updateTargets();target.value=r.target?.id||r.space;draft=r.points.map(p=>p.slice());work.regions=work.regions.filter(x=>x!==r);active=null;loadRadius();paint();}},'Redibujar'),
    h('button',{type:'button',class:'ag-btn danger','aria-label':'Quitar zona',onclick:()=>{work.regions=work.regions.filter(x=>x!==r);if(active===r.id)active=work.regions[0]?.id||null;loadRadius();paint();}},icon('trash')))));
   spotList.replaceChildren(...work.spots.map(sp=>h('li',{},scenes.find(s=>s.id===sp.scene)?.name||'Escena ausente',h('button',{type:'button',class:'ag-btn danger','aria-label':'Quitar punto',onclick:()=>{work.spots=work.spots.filter(x=>x!==sp);paint();}},icon('trash')))));
   const outside=work.spots.filter(sp=>!allowed().has(sp.scene));
   err.textContent=outside.length?`${outside.length} punto(s) fuera del alcance. Quítalos o cambia la asociación antes de guardar.`:'';
   coverage.textContent=`${work.regions.length} zonas · ${work.spots.length} escenas ubicadas`;
  }
  const m=modal({title:`Zonas: ${work.title||'Vista'}`,wide:true,dismissable:false,
   body:[h('div',{class:'pn-inline'},modeButtons,field('Tipo',type),field('Esta vista corresponde a',scope)),h('p',{},'Marca el contorno y cierra la zona. Puedes alternar 90° durante el dibujo.'),zoneTools,spotTools,stage,err,coverage,shapeControls,
    h('div',{class:'pn-grid'},h('div',{},h('h3',{},'Zonas'),zoneList),h('div',{},h('h3',{},'Escenas 360°'),spotList))],
   actions:[{label:'Cancelar',onClick:()=>m.close()},{label:'Listo y guardar',primary:true,onClick:async()=>{
    if(draft.length){if(!confirm('Hay una figura sin cerrar. ¿Cerrarla antes de guardar?'))return;closeDraft();if(draft.length)return;}
    if(work.spots.some(sp=>!allowed().has(sp.scene))){paint();return;}
    work.kind=type.value;m.setBusy(true,'Guardando…');try{await onSave(work);m.close();}catch(e){err.textContent=e.message;m.setBusy(false);}
   }}]});
  m.el.classList.add('pn-vmodal');updateScenes();loadRadius();return m;
 }
 root.AgelViewEditor={open};
})(window);
