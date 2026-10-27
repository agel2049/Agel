/* Immersive website shell. The panorama renderer remains behind an adapter. */
(function(root){
 'use strict';const R=root.AgelShowroomRelations,G=root.AgelShowroomGeometry;
 const assetRoot=new URL('../../',document.currentScript.src).href;
 const h=(tag,attrs={},...kids)=>{const el=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(v==null||v===false)continue;if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else el.setAttribute(k,String(v));}for(const child of kids.flat())if(child!=null)el.append(child.nodeType?child:document.createTextNode(String(child)));return el;};
 const svg=(tag,attrs={})=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};
 const arrow=()=>{const s=svg('svg',{viewBox:'0 0 24 24','aria-hidden':'true',width:20,height:20});s.append(svg('path',{d:'M5 12h14M13 6l6 6-6 6',fill:'none',stroke:'currentColor','stroke-width':1.5}));return s;};
 const icon=path=>{const s=svg('svg',{viewBox:'0 0 24 24','aria-hidden':'true',width:20,height:20});s.append(svg('path',{d:path,fill:'none',stroke:'currentColor','stroke-width':1.5,'stroke-linecap':'round','stroke-linejoin':'round'}));return s;};
 const openingLocks=new Set();let priorLock=false;
 function lockOpening(owner,locked){
  if(locked&&!openingLocks.has(owner)){if(!openingLocks.size)priorLock=document.documentElement.classList.contains('ax-opening-active');openingLocks.add(owner);document.documentElement.classList.add('ax-opening-active');root.scrollTo(0,0);}
  else if(!locked&&openingLocks.delete(owner)&&!openingLocks.size&&!priorLock)document.documentElement.classList.remove('ax-opening-active');
 }
 function mount(container,{manifest:m,navigation:n,resolveMedia=ref=>ref,openTour,onBim,onLocalModel,onModel}){
  let fitMode=false,disposed=false,sequence=0,tour=null,video=null,restoring=false,selected=null,bimHandler=onBim,inertSiblings=null;
  const scopeSpaces=R.normalizeSpaces(m.spaces,m.scenes),views=m.content.views,ex=m.content.experience;
  const button=(label,action,attrs={})=>h('button',{type:'button',...attrs,onclick:action},label);
  const logo=()=>h('img',{class:'ax-logo',src:assetRoot+'assets/brand/archgel-symbol.png',alt:'Archgel',width:96,height:56});
  const dispatch=a=>n.dispatch(a),stage=h('div',{class:'ax-stage'}),content=h('div',{class:'ax-content'}),status=h('p',{class:'ax-status',role:'status','aria-live':'polite'});
  const crumb=h('p',{class:'ax-crumb'}),back=button('Volver',()=>n.back(),{class:'ax-quiet'}),levelNav=h('nav',{'aria-label':'Niveles',class:'ax-levels'});
  const locationPanel=h('section',{class:'ax-location','aria-label':'Ubicación del proyecto',hidden:true}),locationButton=button('Ubicación',()=>{locationPanel.hidden=!locationPanel.hidden;locationButton.setAttribute('aria-expanded',String(!locationPanel.hidden));},{'aria-expanded':false});
  const loc=m.content.location||{};locationPanel.append(...[h('h2',{},'Ubicación'),h('p',{},loc.address||m.project.location||'Ubicación por confirmar'),loc.notes?h('p',{},loc.notes):null,
   loc.map_url?h('a',{href:loc.map_url,target:'_blank',rel:'noopener noreferrer'},'Abrir mapa'):null,button('Cerrar',()=>{locationPanel.hidden=true;locationButton.setAttribute('aria-expanded','false');locationButton.focus();},{'aria-label':'Cerrar ubicación'})].filter(Boolean));
  const bim=button('BIM',()=>bimHandler?.(),{hidden:!bimHandler,'aria-label':'Modelo BIM · equipo',title:'Modelo BIM · acceso del equipo'});
  const lower=h('div',{class:'ax-lower'},locationButton,bim,...(m.content.model3d?[onLocalModel?button('Maqueta',onLocalModel,{'aria-label':'Modelo 3D local'}):onModel?button('Maqueta',onModel,{'aria-label':'Maqueta virtual'}):h('a',{href:'#modelo'},'Maqueta')]:[]),h('a',{href:'#contacto','aria-label':'Solicitar información'},'Contacto'));
  const mobile=matchMedia('(max-width:760px)'),tools=h('details',{class:'ax-tools',open:!mobile.matches},h('summary',{},'Proyecto'),lower),adaptTools=()=>tools.open=!mobile.matches;mobile.addEventListener('change',adaptTools);
  const home=()=>dispatch({type:m.opening?.enabled?'OPENING':'FACADE'});
  const sidebar=h('aside',{class:'ax-sidebar'},button('',home,{class:'ax-brand','aria-label':'Volver al inicio del proyecto'}),tools);sidebar.firstChild.append(logo());
  const stepTitle=h('h1'),stepHint=h('p');
  const building=button('Fachada',()=>dispatch({type:'FACADE'}),{class:'ax-facade'});
  const band=h('footer',{class:'ax-band'},h('div',{class:'ax-band-copy'},stepTitle),stepHint,building);
  const full=button('Pantalla completa',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{status.textContent='Usa la opción de pantalla completa de tu navegador.';}},{class:'ax-quiet'});
  // Icon controls keep their full accessible names and native tooltips.
  back.replaceChildren(icon('M19 12H5m6-6-6 6 6 6'));back.setAttribute('aria-label','Volver');back.title='Volver';
  full.replaceChildren(icon('M8 4H4v4m12-4h4v4M4 16v4h4m8 0h4v-4'));full.setAttribute('aria-label','Pantalla completa');full.title='Pantalla completa';
  const fitButton=button('',ev=>{fitMode=!fitMode;ev.currentTarget.setAttribute('aria-pressed',String(fitMode));fit();},{class:'ax-quiet','aria-pressed':false,'aria-label':'Ver imagen completa',title:'Ver imagen completa'});fitButton.append(icon('M3 6h18v12H3zM7 10l3 4 3-3 4 5M16 9h.01'));
  const body=h('div',{class:'ax-workspace'},sidebar,h('header',{class:'ax-project-title'},h('h2',{},m.project.name)),h('div',{class:'ax-main'},h('div',{class:'ax-top'},back,crumb,fitButton,full),status,stage,content,locationPanel),levelNav,band);
  const section=h('section',{class:'ax-experience','aria-label':'Explorar proyecto'});container.append(section);
  function setOpening(locked){
   lockOpening(section,locked);
   if(locked&&!inertSiblings){inertSiblings=[];for(let branch=section;branch?.parentElement&&branch!==document.body;branch=branch.parentElement)for(const sibling of branch.parentElement.children)if(sibling!==branch&&'inert'in sibling){inertSiblings.push([sibling,sibling.inert]);sibling.inert=true;}}
   else if(!locked&&inertSiblings){for(const [sibling,prior]of inertSiblings)sibling.inert=prior;inertSiblings=null;}
  }
  function buildingOf(id){const seen=new Set();let space=m.spaces.find(s=>s.id===id);while(space&&!seen.has(space.id)){seen.add(space.id);if(space.kind==='edificio')return space;space=m.spaces.find(s=>s.id===space.parent_id);}return null;}
  function levelOf(id){const seen=new Set();let s=m.spaces.find(s=>s.id===id);while(s&&!seen.has(s.id)){seen.add(s.id);if(s.kind==='nivel')return s.id;s=m.spaces.find(p=>p.id===s.parent_id);}return null;}
  function renderLevels(state){
   const view=views.find(v=>v.id===state.viewId),active=buildingOf(state.spaceId||view?.spaceId),multiple=m.spaces.filter(s=>s.kind==='edificio').length>1;
   const label=(name,spaceId)=>{const b=buildingOf(spaceId);return !active&&multiple&&b?b.name+' · '+name:name;};
   const levels=m.spaces.filter(s=>s.kind==='nivel'&&(!active||buildingOf(s.id)?.id===active.id)).sort((a,b)=>(a.position??0)-(b.position??0)||a.name.localeCompare(b.name,'es',{numeric:true}));
   const levelIds=new Set(levels.map(s=>s.id));
   const lobbies=views.filter(v=>v.role==='lobby'&&!levelIds.has(v.spaceId)&&(!active||!v.spaceId||buildingOf(v.spaceId)?.id===active.id));
   levelNav.replaceChildren(h('p',{class:'ax-nav-label'},active?active.name:'Niveles'),...lobbies.map(v=>button(label(v.title,v.spaceId),()=>dispatch({type:'OPEN_VIEW',id:v.id}),{'data-view':v.id})),...levels.map(s=>{const available=views.some(v=>v.spaceId===s.id);return button(label(s.name,s.id),()=>dispatch({type:'OPEN_SPACE',id:s.id}),{'data-level':s.id,disabled:!available,title:available?label(s.name,s.id):'Planta pendiente de configurar'});}));
   levelNav.hidden=!levels.length&&!lobbies.length;
  }
  function fit(){for(const frame of stage.querySelectorAll('.ax-frame')){const ratio=Number(frame.dataset.ratio)||16/9,w=Math[fitMode?'min':'max'](stage.clientWidth,stage.clientHeight*ratio);frame.style.width=w+'px';frame.style.height=w/ratio+'px';}}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),animations=new Set();
  function animate(el,keyframes,options={}){if(reduced.matches||disposed)return;const a=el.animate(keyframes,{duration:600,easing:'cubic-bezier(.22,1,.36,1)',...options});animations.add(a);a.finished.catch(()=>{}).finally(()=>animations.delete(a));return a;}
  function stopMotion(){for(const a of animations)a.cancel();animations.clear();}
  const adaptMotion=()=>{if(reduced.matches)stopMotion();};reduced.addEventListener('change',adaptMotion);
  function reveal(frame){
   const previous=stage.querySelector('.ax-frame:last-child');
   if(previous&&!reduced.matches){previous.style.position='absolute';previous.inert=true;previous.setAttribute('aria-hidden','true');stage.replaceChildren(previous,frame);const exit=animate(previous,[{opacity:1},{opacity:0,transform:'scale(1.006)'}],{duration:480});exit?.finished.catch(()=>{}).finally(()=>previous.remove());}
   else stage.replaceChildren(frame);
   fit();animate(frame,[{opacity:0,filter:'blur(4px)',transform:'translateY(6px) scale(1.018)'},{opacity:1,filter:'blur(0)',transform:'translateY(0) scale(1)'}],{duration:700});
  }
  const observer=new ResizeObserver(fit);observer.observe(stage);
  async function opening(seq){
   const o=m.opening||{},wrap=h('div',{class:'ax-opening'}),copy=h('div',{class:'ax-opening-copy'},logo());
   const go=button('Iniciar',()=>dispatch({type:'ENTER_PROJECT'}),{class:'ax-enter'});go.append(arrow());copy.append(go);
   if(o.poster){const url=await resolveMedia(o.poster);if(seq!==sequence)return;wrap.append(h('img',{src:url,alt:'',class:'ax-opening-media'}));}
   if(o.video){const url=await resolveMedia(o.video);if(seq!==sequence)return;video=h('video',{src:url,playsinline:true,muted:true,loop:true,preload:'metadata',class:'ax-opening-media','aria-hidden':true});video.muted=true;wrap.append(video);video.play().catch(()=>{});}
   wrap.append(copy);section.replaceChildren(wrap);
   animate(wrap.querySelector('.ax-opening-media')||wrap,[{opacity:.5,transform:'scale(1.035)'},{opacity:1,transform:'scale(1)'}],{duration:1100});
   animate(copy.querySelector('.ax-logo'),[{opacity:0,filter:'blur(8px)',transform:'translateY(6px)'},{opacity:1,filter:'blur(0)',transform:'translateY(0)'}],{duration:850});
   animate(go,[{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{delay:180,duration:600});
  }
  function activate(r){const target=r.target||(r.space?{type:'space',id:r.space}:null);if(target)dispatch({type:{view:'OPEN_VIEW',space:'OPEN_SPACE',scene:'OPEN_SCENE'}[target.type],id:target.id});}
  async function render(state){
   const seq=++sequence;status.textContent=state.error||'';renderLevels(state);setOpening(state.kind==='opening');
   section.dataset.state=state.kind;
   const facade=state.kind==='facade',isTour=state.kind==='tour';
   stepHint.textContent=facade?'Elige un nivel':isTour?'360°':'Elige un espacio';building.hidden=facade;
   if(tour&&state.kind!=='tour'){const old=tour;tour=null;old.close?.();}
   if(state.kind==='tour'){
    if(!tour){tour=openTour({manifest:m,sceneId:state.sceneId,spaceId:state.spaceId,onClose:()=>{tour=null;if(n.state.kind==='tour')n.back();}})||{close(){}};}return;
   }
   if(video){video.pause();video.removeAttribute('src');video.load();video=null;}
   if(state.kind==='opening'){await opening(seq);return;}
   const entering=!body.isConnected;section.replaceChildren(body);stage.setAttribute('aria-busy','true');
   for(const frame of stage.querySelectorAll('.ax-frame')){frame.inert=true;frame.setAttribute('aria-hidden','true');}
   if(entering){animate(band,[{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{delay:100});for(const [i,el]of [sidebar,levelNav].entries())animate(el,[{opacity:0,transform:`translateX(${i?8:-8}px)`},{opacity:1,transform:'translateX(0)'}],{delay:180+i*70,duration:500});}
   const v=views.find(v=>v.id===state.viewId),space=m.spaces.find(s=>s.id===state.spaceId);
   stepTitle.textContent=v?.title||space?.name||'Proyecto';
   crumb.textContent=[m.project.name,v?.title,space?.name].filter((x,i,a)=>x&&a.indexOf(x)===i).join(' / ');
   for(const b of levelNav.querySelectorAll('button'))b.setAttribute('aria-current',String(b.dataset.level===levelOf(state.spaceId)||b.dataset.view===state.viewId));
   content.replaceChildren();
   if(space&&state.kind==='unit'){
    const ids=R.sceneIdsForScope(space.id,scopeSpaces,m.scenes),mapped=new Set((v?.spots||[]).map(sp=>sp.sceneId||sp.scene).map(id=>typeof id==='number'?m.scenes[id]?.id:id));
    for(const r of v?.regions||[])if(r.target?.type==='scene')mapped.add(r.target.id);
    const scenes=m.scenes.filter(s=>ids.includes(s.id)&&!mapped.has(s.id));
    if(scenes.length||!ids.length&&!v?.regions?.length)content.append(h('div',{class:'ax-unit'},h('div',{class:'ax-room-buttons'},...scenes.map(s=>button(s.name,()=>dispatch({type:'OPEN_SCENE',id:s.id}))),!ids.length?h('p',{},'Sin recorrido configurado'):null)));
   }
   if(!v){stage.replaceChildren(h('p',{},'Este espacio aún no tiene una planta. Explora su ficha o vuelve a la fachada.'));stage.removeAttribute('aria-busy');return;}
   try{
    const url=await resolveMedia(v.image);if(seq!==sequence||disposed)return;
    const image=h('img',{src:url,alt:v.title||'Vista del proyecto',decoding:'async'});await image.decode();if(seq!==sequence||disposed)return;
    const w=v.w||1600,hh=v.h||900,frame=h('div',{class:'ax-frame','data-ratio':w/hh},image),overlay=svg('svg',{viewBox:`0 0 ${w} ${hh}`,class:'ax-zones','aria-label':'Áreas del proyecto'});
    for(const r of v.regions||[]){const dest=m.spaces.find(s=>s.id===(r.target?.type==='space'?r.target.id:r.space)),label=dest?.name||m.scenes.find(s=>s.id===r.target?.id)?.name||views.find(v=>v.id===r.target?.id)?.title||'Explorar área';
     const path=svg('path',{d:G.roundedPath(r.points,{w,h:hh,radius:r.radius||0}),class:'sr-area',tabindex:0,role:'button','aria-label':label});
     path.addEventListener('keydown',ev=>{if(['Enter',' '].includes(ev.key)){ev.preventDefault();activate(r);}});
     path.addEventListener('click',ev=>{if(ev.pointerType==='touch'&&selected!==r.id){selected=r.id;for(const p of overlay.querySelectorAll('.sr-area'))p.classList.toggle('is-selected',p===path);return;}activate(r);});
     overlay.append(path);
    }frame.append(overlay);
    const ids=new Set(R.sceneIdsForScope(state.spaceId,scopeSpaces,m.scenes));
    for(const sp of v.spots||[]){const scene=m.scenes.find(s=>s.id===(sp.sceneId||sp.scene))||m.scenes[sp.scene];if(!scene||!ids.has(scene.id))continue;
     const spot=button(scene.name,()=>dispatch({type:'OPEN_SCENE',id:scene.id}),{class:'ax-spot',style:`left:${sp.x}%;top:${sp.y}%`,'aria-label':scene.name});spot.replaceChildren(arrow(),h('span',{},scene.name));frame.append(spot);
    }
    if(v.id===ex.facadeViewId&&ex.entryTargetViewId){const enter=button(ex.entrance.label||'Entrar',()=>dispatch({type:'OPEN_VIEW',id:ex.entryTargetViewId}),{class:'ax-entrance',style:`left:${ex.entrance.x}%;top:${ex.entrance.y}%`});enter.prepend(arrow());frame.append(enter);}
    reveal(frame);stage.removeAttribute('aria-busy');
   }catch(error){if(seq!==sequence||disposed)return;stage.removeAttribute('aria-busy');status.textContent='No se pudo cargar esta imagen. Revisa tu conexión y vuelve a seleccionar la vista.';}
  }
  function updateHistory(){if(restoring)return;const q=new URLSearchParams(location.search);for(const k of ['view','space','scene'])q.delete(k);for(const[k,v]of new URLSearchParams(n.serialize()))q.set(k,v);history.pushState({agelShowroom:true},'',location.pathname+'?'+q+location.hash);}
  const query=new URLSearchParams(location.search);if(['view','space','scene'].some(k=>query.has(k)))n.restore(query);
  if(query.get('unidad'))n.dispatch({type:'OPEN_SPACE',id:query.get('unidad')});if(query.get('escena'))n.restore('?scene='+query.get('escena'));
  const unsubscribe=n.subscribe(s=>{updateHistory();render(s);});
  const pop=()=>{restoring=true;n.restore(new URLSearchParams(location.search));restoring=false;};root.addEventListener('popstate',pop);render(n.state);
  return {setBimAccess(handler){bimHandler=handler;bim.hidden=!handler;},dispose(){disposed=true;sequence++;setOpening(false);stopMotion();unsubscribe();observer.disconnect();mobile.removeEventListener('change',adaptTools);reduced.removeEventListener('change',adaptMotion);root.removeEventListener('popstate',pop);video?.pause();tour?.close();section.remove();}};
 }
 root.AgelShowroomExperience={mount};
})(window);
