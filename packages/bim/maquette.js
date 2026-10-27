/* Shared GLB maquette UI. Entry points own authorization and file acquisition. */
(function(root){
 'use strict';let counter=0;
 function h(tag,attrs={},...children){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v===false||v==null)continue;if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,String(v));}for(const c of children.flat())if(c!=null)e.append(c.nodeType?c:document.createTextNode(String(c)));return e;}
 function mount(host,{blob,title='Maqueta virtual',onClose,backUrl,backLabel='Volver al showroom',onLoaded=()=>{}}){
  let view,native,disposed=false,expanded=!matchMedia('(max-width:700px)').matches,mode='checking',busy=false,active=false,hasVisible=false,nativeReady=false,spin=false;
  const filters={preset:'all',query:'',facets:{}},presets=[],facetInputs=[],id='mq-'+(++counter);
  const button=(text,fn,attrs={})=>h('button',{type:'button',...attrs,onclick:ev=>{try{Promise.resolve(fn(ev)).catch(report);}catch(e){report(e);}}},text);
  const error=h('p',{class:'mq-error',role:'alert'}),count=h('p',{role:'status',class:'mq-count'},'Cargando maqueta…'),arNote=h('p',{role:'status',class:'mq-ar-note'},'Comprobando realidad aumentada…');
  const stage=h('div',{class:'mq-stage'}),panel=h('aside',{id:'bm-local-filters',class:'mq-filters','aria-label':'Filtros de la maqueta'},h('h2',{},'Filtros'),count);
  const toggle=button('Filtros',()=>{expanded=!expanded;sync();},{'aria-expanded':expanded,'aria-controls':'bm-local-filters'});
  const back=backUrl?h('a',{href:backUrl,class:'mq-button'},backLabel):button('Cerrar maqueta',()=>{if(onClose)onClose();else dispose();});
  const arButton=button('Ver en mi espacio',async()=>{
   if(!view||!hasVisible||busy)return;error.textContent='';spin=false;view.setSpin(false);rotate.setAttribute('aria-pressed','false');
   if(mode==='webxr'){await view.ar.start(shell);return;}
   if(mode==='quicklook'){
    busy=true;sync();
    try{
     if(!nativeReady){native?.dispose();native=AgelGLBAR.quickLook({blob,extent:view.extent,host:shell});arNote.textContent='Preparando la maqueta completa para iPhone. Los filtros de esta vista no se trasladan a Quick Look.';await native.ready;if(disposed)return;nativeReady=true;arNote.textContent='Lista. Pulsa Ver en mi espacio. Quick Look muestra la maqueta completa con los controles de Apple.';}
     else await native.open();
    }catch(e){native?.dispose();native=null;nativeReady=false;throw e;}finally{busy=false;sync();}
   }
  },{disabled:true,class:'mq-ar-start'});
  const top=h('header',{class:'mq-top'},back,h('h1',{},title),toggle,arButton);
  const select=h('select',{'aria-label':'Vista de maqueta',disabled:true,onchange:()=>{view?.setView(select.value);spin=false;rotate.setAttribute('aria-pressed','false');}});
  for(const[value,label]of [['iso','Perspectiva'],['top','Planta'],['front','Frente'],['right','Lateral']])select.append(h('option',{value},label));
  const fit=button('Encuadrar',()=>view?.fit(),{disabled:true}),near=button('+',()=>view?.zoom(.8),{'aria-label':'Acercar maqueta',disabled:true}),far=button('−',()=>view?.zoom(1.25),{'aria-label':'Alejar maqueta',disabled:true});
  const rotate=button('Giro automático',()=>{spin=!spin;view?.setSpin(spin);rotate.setAttribute('aria-pressed',String(spin));},{'aria-pressed':'false',disabled:true});
  const camera=h('nav',{class:'mq-camera','aria-label':'Controles de maqueta'},select,fit,near,far,rotate);
  const size=h('select',{'aria-label':'Tamaño máximo de la maqueta',onchange:()=>view?.ar?.setSize(Number(size.value))},...[[.5,'50 cm'],[1,'1 metro'],[2,'2 metros']].map(([value,label])=>h('option',{value,selected:value===1},label)));
  const reposition=button('Recolocar',()=>view?.ar?.reposition()),turn=button('Girar 90°',()=>view?.ar?.rotate()),exit=button('Salir de cámara',()=>view?.ar?.end());
  const arTools=h('nav',{class:'mq-ar-tools',hidden:true,'aria-label':'Controles de realidad aumentada'},size,turn,reposition,exit);
  const help=h('p',{class:'mq-help'},'Arrastra para girar · Rueda o dos dedos para acercar · WASD o flechas para desplazar con el modelo enfocado');
  const shell=h('section',{class:'ag-maquette','aria-label':'Maqueta virtual','data-ar':'idle'},stage,top,panel,h('footer',{class:'mq-bottom'},error,arNote,help,camera,arTools));host.append(shell);
  const ordinary=[select,fit,near,far,rotate];
  function sync(){if(disposed)return;panel.hidden=!expanded||active;toggle.hidden=active;toggle.setAttribute('aria-expanded',String(expanded&&!active));camera.hidden=active;help.hidden=active;arTools.hidden=!active;arButton.hidden=active;arButton.disabled=busy||!hasVisible||!['webxr','quicklook'].includes(mode);arButton.textContent=busy?'Preparando AR…':mode==='quicklook'&&!nativeReady?'Preparar AR':'Ver en mi espacio';for(const e of ordinary)e.disabled=!view||!hasVisible;}
  function report(e){if(e?.name==='AbortError')return;if(!disposed){error.textContent=e?.message||'No se pudo abrir la maqueta. Vuelve a intentar.';sync();}}
  function arState({state,message}){if(disposed)return;active=['starting','searching','placed'].includes(state);busy=state==='starting';shell.dataset.ar=state;arNote.textContent=message||(mode==='webxr'?'Coloca la maqueta sobre una mesa o el suelo.':'');if(state==='starting'){spin=false;rotate.setAttribute('aria-pressed','false');}sync();}
  function apply(){if(!view||disposed)return;const visible=view.filter(filters);hasVisible=visible.length>0;const small=blob.size<1048576,bytes=(blob.size/(small?1024:1048576)).toLocaleString('es-MX',{maximumFractionDigits:1});count.textContent=`${visible.length} de ${view.elements.length} piezas · ${bytes} ${small?'KB':'MB'}`;for(const[value,b]of presets)b.setAttribute('aria-pressed',String(filters.preset===value));sync();}
  const ready=(async()=>{
   try{
    const loaded=await AgelGLB.open(stage,{blob,onARState:arState});if(disposed){loaded.dispose();return;}view=loaded;
    const search=h('input',{type:'search',placeholder:'Nombre, grupo o material','aria-label':'Buscar piezas',oninput:()=>{filters.query=search.value;apply();}});
    const group=h('div',{class:'mq-presets'});
    for(const[value,label]of [['all','Todo'],['mep','Instalaciones'],['masonry','Albañilería'],['structure','Estructura'],['rebar','Varillas'],['finishes','Acabados'],['grey','Obra gris']]){
     const n=AgelGLBFilters.select(view.elements,{preset:value}).length,b=button(`${label} (${n})`,()=>{filters.preset=value;apply();view.fit();},{disabled:!n,'aria-pressed':value==='all'});presets.push([value,b]);group.append(b);
    }
    panel.append(h('label',{class:'mq-search',for:id+'-search'},'Buscar piezas'),search,group,button('Ver todo',()=>{filters.preset='all';filters.query='';filters.facets={};search.value='';for(const e of facetInputs)e.checked=false;apply();view.fit();}));search.id=id+'-search';
    const facets=AgelGLBFilters.facets(view.elements),labels={discipline:'Instalación o disciplina',category:'Categoría',level:'Nivel',group:'Grupo del modelo',material:'Material'};
    for(const f of AgelGLBFilters.fields){const list=h('div',{class:'mq-values'}),values=Object.entries(facets[f]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'es',{numeric:true}));
     for(const[value,n]of values.slice(0,150)){const input=h('input',{type:'checkbox',onchange:()=>{const set=new Set(filters.facets[f]||[]);input.checked?set.add(value):set.delete(value);filters.facets[f]=[...set];apply();}});facetInputs.push(input);list.append(h('label',{},input,h('span',{},value),h('small',{},n)));}
     panel.append(h('details',{open:f==='discipline'},h('summary',{},labels[f]),list,...(values.length>150?[h('p',{},'Mostrando los 150 valores más frecuentes. Usa la búsqueda para encontrar otras piezas.')]:[])));
    }
    if(view.elements.length===1)panel.append(h('p',{class:'mq-note'},'El modelo contiene una sola pieza. Exporta objetos separados para filtrar instalaciones.'));
    if(view.elements.some(e=>e.source!=='properties'))panel.append(h('p',{class:'mq-note'},'Las piezas sin propiedades BIM se agrupan por nombres y materiales. Esa clasificación es orientativa.'));
    apply();onLoaded(view);
    const webxr=await view.ar?.supported();if(disposed)return;
    if(webxr){mode='webxr';arNote.textContent='Coloca la maqueta sobre una mesa o el suelo.';}
    else if(/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)){mode='quicklook';arNote.textContent='Prepara AR para abrir la maqueta completa con Quick Look de Apple.';}
    else {mode='unsupported';arNote.textContent='AR no está disponible en este equipo o navegador. Puedes explorar la maqueta en 3D.';}
    sync();
   }catch(e){if(!disposed){count.textContent='No se pudo abrir el modelo';mode='unsupported';arNote.textContent='';report(e);}throw e;}
  })();
  // Entry points may close during loading; do not leave an unhandled rejection.
  ready.catch(()=>{});
  function dispose(){if(disposed)return;disposed=true;native?.dispose();view?.dispose();shell.remove();}
  sync();return {ready,dispose};
 }
 root.AgelMaquette={mount};
})(window);
