/* Immersive website shell. The panorama renderer remains behind an adapter. */
(function(root){
 'use strict';const R=root.AgelShowroomRelations,G=root.AgelShowroomGeometry;
 const h=(tag,attrs={},...kids)=>{const el=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(v==null||v===false)continue;if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else el.setAttribute(k,String(v));}for(const child of kids.flat())if(child!=null)el.append(child.nodeType?child:document.createTextNode(String(child)));return el;};
 const svg=(tag,attrs={})=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};
 const arrow=()=>{const s=svg('svg',{viewBox:'0 0 24 24','aria-hidden':'true',width:20,height:20});s.append(svg('path',{d:'M5 12h14M13 6l6 6-6 6',fill:'none',stroke:'currentColor','stroke-width':1.5}));return s;};
 function mount(container,{manifest:m,navigation:n,resolveMedia=ref=>ref,openTour,onBim}){
  let fitMode=false,disposed=false,sequence=0,tour=null,video=null,restoring=false,selected=null,bimHandler=onBim;
  const scopeSpaces=R.normalizeSpaces(m.spaces,m.scenes),views=m.content.views,ex=m.content.experience;
  const button=(label,action,attrs={})=>h('button',{type:'button',...attrs,onclick:action},label);
  const dispatch=a=>n.dispatch(a),stage=h('div',{class:'ax-stage'}),content=h('div',{class:'ax-content'}),status=h('p',{class:'ax-status',role:'status','aria-live':'polite'});
  const crumb=h('p',{class:'ax-crumb'}),back=button('Volver',()=>n.back(),{class:'ax-quiet'}),levelNav=h('nav',{'aria-label':'Niveles',class:'ax-levels'});
  const locationPanel=h('section',{class:'ax-location','aria-label':'Ubicación del proyecto',hidden:true}),locationButton=button('Ubicación',()=>{locationPanel.hidden=!locationPanel.hidden;locationButton.setAttribute('aria-expanded',String(!locationPanel.hidden));},{'aria-expanded':false});
  const loc=m.content.location||{};locationPanel.append(...[h('h2',{},'Ubicación'),h('p',{},loc.address||m.project.location||'Ubicación por confirmar'),loc.notes?h('p',{},loc.notes):null,
   loc.map_url?h('a',{href:loc.map_url,target:'_blank',rel:'noopener noreferrer'},'Abrir mapa'):null,button('Cerrar ubicación',()=>{locationPanel.hidden=true;locationButton.setAttribute('aria-expanded','false');locationButton.focus();},{class:'ax-quiet'})].filter(Boolean));
  const bim=button('Modelo BIM · equipo',()=>bimHandler?.(),{hidden:!bimHandler});
  const lower=h('div',{class:'ax-lower'},locationButton,bim,h('a',{href:'#contacto'},'Solicitar información'));
  const sidebar=h('aside',{class:'ax-sidebar'},h('a',{class:'ax-brand',href:'#'},m.brand.name||'AgelArq'),h('h2',{},m.project.name),levelNav,lower);
  const body=h('div',{class:'ax-workspace'},sidebar,h('div',{class:'ax-main'},h('div',{class:'ax-top'},back,crumb,button('Ver imagen completa',ev=>{fitMode=!fitMode;ev.currentTarget.setAttribute('aria-pressed',String(fitMode));fit();},{class:'ax-quiet','aria-pressed':false}),button('Fachada',()=>dispatch({type:'FACADE'}),{class:'ax-quiet'})),status,stage,content,locationPanel));
  const section=h('section',{class:'ax-experience','aria-label':'Explorar proyecto'});container.append(section);
  const levels=m.spaces.filter(s=>s.kind==='nivel');
  levelNav.append(h('p',{class:'ax-nav-label'},'Explorar niveles'),...levels.map(s=>button(s.name,()=>dispatch({type:'OPEN_SPACE',id:s.id}),{'data-level':s.id})),...views.filter(v=>v.role==='lobby').map(v=>button(v.title,()=>dispatch({type:'OPEN_VIEW',id:v.id}),{'data-view':v.id})));
  function fit(){const frame=stage.querySelector('.ax-frame');if(!frame)return;const ratio=Number(frame.dataset.ratio)||16/9,w=Math[fitMode?'min':'max'](stage.clientWidth,stage.clientHeight*ratio);frame.style.width=w+'px';frame.style.height=w/ratio+'px';}
  const observer=new ResizeObserver(fit);observer.observe(stage);
  async function opening(seq){
   const o=m.opening||{},wrap=h('div',{class:'ax-opening'}),copy=h('div',{class:'ax-opening-copy'},h('span',{class:'ax-brand'},m.brand.name||'AgelArq'),h('h1',{},o.title||m.project.name),o.subtitle?h('p',{},o.subtitle):null);
   const go=button(o.button||'Ver proyecto',()=>dispatch({type:'ENTER_PROJECT'}),{class:'ax-enter'});go.append(arrow());copy.append(go);
   if(o.poster){const url=await resolveMedia(o.poster);if(seq!==sequence)return;wrap.append(h('img',{src:url,alt:'',class:'ax-opening-media'}));}
   if(o.video){const url=await resolveMedia(o.video);if(seq!==sequence)return;video=h('video',{src:url,playsinline:true,muted:true,loop:true,preload:'metadata',class:'ax-opening-media','aria-hidden':true});video.muted=true;wrap.append(video);video.play().catch(()=>{});}
   wrap.append(copy,h('a',{class:'ax-opening-info',href:'#contacto'},'Información del proyecto'));section.replaceChildren(wrap);
  }
  function activate(r){const target=r.target||(r.space?{type:'space',id:r.space}:null);if(target)dispatch({type:{view:'OPEN_VIEW',space:'OPEN_SPACE',scene:'OPEN_SCENE'}[target.type],id:target.id});}
  async function render(state){
   const seq=++sequence;status.textContent=state.error||'';
   if(tour&&state.kind!=='tour'){const old=tour;tour=null;old.close?.();}
   if(state.kind==='tour'){
    if(!tour){tour=openTour({manifest:m,sceneId:state.sceneId,spaceId:state.spaceId,onClose:()=>{tour=null;if(n.state.kind==='tour')n.back();}})||{close(){}};}return;
   }
   if(video){video.pause();video.removeAttribute('src');video.load();video=null;}
   if(state.kind==='opening'){await opening(seq);return;}
   section.replaceChildren(body);stage.setAttribute('aria-busy','true');
   const v=views.find(v=>v.id===state.viewId),space=m.spaces.find(s=>s.id===state.spaceId);
   crumb.textContent=[m.project.name,v?.title,space?.name].filter((x,i,a)=>x&&a.indexOf(x)===i).join(' / ');
   for(const b of levelNav.querySelectorAll('button'))b.setAttribute('aria-current',String(b.dataset.level===state.spaceId||b.dataset.view===state.viewId||!!space&&m.spaces.find(s=>s.id===space.parent_id)?.id===b.dataset.level));
   content.replaceChildren();
   if(space&&state.kind==='unit'){
    const ids=R.sceneIdsForScope(space.id,scopeSpaces,m.scenes),scenes=m.scenes.filter(s=>ids.includes(s.id));
    content.append(h('div',{class:'ax-unit'},h('div',{},h('h2',{},space.name),h('p',{},[space.area_m2?`${space.area_m2} m²`:null,space.bedrooms?`${space.bedrooms} recámaras`:null,space.summary].filter(Boolean).join(' · '))),h('div',{class:'ax-room-buttons'},...scenes.map(s=>button(s.name,()=>dispatch({type:'OPEN_SCENE',id:s.id}))),!scenes.length?h('p',{},'Recorrido de este espacio pendiente de configurar.'):null)));
   }
   if(!v){stage.replaceChildren(h('p',{},'Este espacio aún no tiene una planta. Explora su ficha o vuelve a la fachada.'));stage.removeAttribute('aria-busy');return;}
   try{
    const url=await resolveMedia(v.image);if(seq!==sequence||disposed)return;
    const image=h('img',{src:url,alt:v.title||'Vista del proyecto',decoding:'async'});await image.decode();if(seq!==sequence||disposed)return;
    const w=v.w||1600,hh=v.h||900,frame=h('div',{class:'ax-frame','data-ratio':w/hh},image),overlay=svg('svg',{viewBox:`0 0 ${w} ${hh}`,class:'ax-zones','aria-label':'Áreas del proyecto'});
    for(const r of v.regions||[]){const dest=m.spaces.find(s=>s.id===(r.target?.type==='space'?r.target.id:r.space)),label=dest?.name||views.find(v=>v.id===r.target?.id)?.title||'Explorar área';
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
    stage.replaceChildren(frame);stage.removeAttribute('aria-busy');fit();
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)frame.animate([{opacity:.35,transform:'scale(1.012)'},{opacity:1,transform:'scale(1)'}],{duration:450,easing:'cubic-bezier(.22,1,.36,1)'});
   }catch(error){if(seq!==sequence||disposed)return;stage.removeAttribute('aria-busy');status.textContent='No se pudo cargar esta imagen. Revisa tu conexión y vuelve a seleccionar la vista.';}
  }
  function updateHistory(){if(restoring)return;const q=new URLSearchParams(location.search);for(const k of ['view','space','scene'])q.delete(k);for(const[k,v]of new URLSearchParams(n.serialize()))q.set(k,v);history.pushState({agelShowroom:true},'',location.pathname+'?'+q+location.hash);}
  const query=new URLSearchParams(location.search);if(['view','space','scene'].some(k=>query.has(k)))n.restore(query);
  if(query.get('unidad'))n.dispatch({type:'OPEN_SPACE',id:query.get('unidad')});if(query.get('escena'))n.restore('?scene='+query.get('escena'));
  const unsubscribe=n.subscribe(s=>{updateHistory();render(s);});
  const pop=()=>{restoring=true;n.restore(new URLSearchParams(location.search));restoring=false;};root.addEventListener('popstate',pop);render(n.state);
  return {setBimAccess(handler){bimHandler=handler;bim.hidden=!handler;},dispose(){disposed=true;sequence++;unsubscribe();observer.disconnect();root.removeEventListener('popstate',pop);video?.pause();tour?.close();section.remove();}};
 }
 root.AgelShowroomExperience={mount};
})(window);
