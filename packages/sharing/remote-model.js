/* Remote maquette: only rendered pixels and bounded commands cross the session. */
(function(root){
 'use strict';
 const PRESETS=[['all','Todo'],['mep','Instalaciones'],['masonry','Albañilería'],['structure','Estructura'],['finishes','Acabados'],['grey','Obra gris']];
 const VIEWS=[['iso','Perspectiva'],['top','Planta'],['front','Frente'],['right','Lateral']];
 const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
 function host({workspace,container,sessionId,send,onState=()=>{}}){
  const output=document.createElement('canvas');output.width=720;output.height=480;
  const ctx=output.getContext('2d');if(!ctx||!output.captureStream)throw Error('Este navegador no permite transmitir el modelo. Prueba Chrome o Edge.');
  const stage=document.createElement('div');stage.style.width='720px';stage.style.height='480px';container.append(stage);
  let closed=false,paused=true,view=null,loading=null,unsubscribe,epoch=0,accepted=0,windowStart=Date.now(),title='Maqueta virtual',activePreset='all';
  const aborter=new AbortController();
  function watermark(){ctx.save();ctx.fillStyle='rgba(12,14,16,.86)';ctx.fillRect(12,438,360,30);ctx.font='16px system-ui, sans-serif';ctx.fillStyle='#ffffff';ctx.fillText('AgelArq · Sesión '+String(sessionId).slice(0,8),24,459);ctx.restore();}
  function placeholder(message){ctx.fillStyle='#101214';ctx.fillRect(0,0,720,480);ctx.fillStyle='#e6e4df';ctx.font='20px system-ui, sans-serif';ctx.fillText(message,40,230);watermark();}
  placeholder('Modelo transmitido desde la computadora');
  const stream=output.captureStream(15);
  // Static Three.js views render only on demand. Keep publishing their last
  // pixels so an encoder that becomes ready later can obtain its first frame.
  const framePump=setInterval(()=>{if(!closed&&!paused){ctx.drawImage(output,0,0);for(const track of stream.getTracks())track.requestFrame?.();}},200);
  function publish(state,message){
   if(closed)return;
   const metadata={op:'model-state',state,title};
   if(view){metadata.total=view.elements.length;metadata.visible=root.AgelGLBFilters.select(view.elements,{preset:activePreset}).length;metadata.presets=PRESETS.map(([value,label])=>({value,label,count:root.AgelGLBFilters.select(view.elements,{preset:value}).length}));}
   if(message)metadata.message=message;try{send(metadata);}catch{}try{onState(metadata);}catch{}
  }
  function painted(canvas){if(closed||paused)return;ctx.drawImage(canvas,0,0,720,480);watermark();for(const track of stream.getTracks())track.requestFrame?.();}
  async function ownBlob(){
   const draft=await workspace.load();if(closed)throw Error('Sesión cerrada');const model=draft.showroom?.model3d;
   if(!model||typeof model.url!=='string')throw Error('El proyecto no tiene una maqueta GLB.');title=String(model.title||'Maqueta virtual').slice(0,120);
   let blob;
   if(/^agel-local:[\w-]+$/.test(model.url)){
    if(!draft.media?.some(m=>m.ref===model.url))throw Error('La maqueta no pertenece a este proyecto.');
    blob=(await workspace.store.get(model.url))?.blob;
   }else{
    const url=new URL(model.url);if(url.protocol!=='https:'||url.username||url.password||!url.pathname.toLowerCase().endsWith('.glb'))throw Error('La maqueta debe ser un GLB propio o una dirección HTTPS segura.');
    const response=await fetch(url.href,{signal:aborter.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});if(!response.ok)throw Error('No se pudo leer la maqueta.');blob=await response.blob();
   }
   if(closed)throw Error('Sesión cerrada');await workspace.load();if(closed)throw Error('Sesión cerrada');
   if(!(blob instanceof Blob)||!blob.size)throw Error('La maqueta no está disponible.');return blob;
  }
  function open(){
   paused=false;if(view){view.setSpin(false);view.fit();publish('ready');return;}
   if(loading)return;
   const generation=++epoch;publish('loading');placeholder('Preparando la maqueta en la computadora…');
   loading=(async()=>{
    try{
     const blob=await ownBlob();if(closed)return;
     const loaded=await root.AgelGLB.open(stage,{blob,onFrame:painted});
     if(closed||generation!==epoch){loaded.dispose();return;}
     view=loaded;if(paused){view.setSpin(false);publish('paused');}else {view.fit();publish('ready');}
    }catch(e){if(!closed&&generation===epoch){paused=true;placeholder('No se pudo abrir el modelo');publish('error','No se pudo abrir la maqueta en la computadora. Revisa el archivo y vuelve a intentar.');}}
    finally{if(generation===epoch)loading=null;}
   })();
  }
  const fields={open:[],pause:[],view:['view'],zoom:['factor'],pan:['x','y'],orbit:['x','y'],fit:[],spin:['enabled'],filter:['preset']};
  function handle(message){
   if(closed||!message||typeof message!=='object'||message.op!=='model'||!Object.hasOwn(fields,message.action))return;
   const allowed=new Set(['op','action',...fields[message.action]]);if(Object.keys(message).some(k=>!allowed.has(k)))return;
   const now=Date.now();if(now-windowStart>=1000){windowStart=now;accepted=0;}if(accepted>=60)return;accepted++;
   const a=message.action;
   if(a==='open'){open();return;}
   if(a==='pause'){paused=true;view?.setSpin(false);publish('paused');return;}
   if(!view||paused)return;
   if(a==='view'&&VIEWS.some(([v])=>v===message.view))view.setView(message.view);
   else if(a==='zoom'&&Number.isFinite(message.factor)&&message.factor>0)view.zoom(clamp(message.factor,.5,2));
   else if((a==='pan'||a==='orbit')&&Number.isFinite(message.x)&&Number.isFinite(message.y)){view.setSpin(false);view[a](clamp(message.x,-.5,.5),clamp(message.y,-.5,.5));}
   else if(a==='fit')view.fit();
   else if(a==='spin'&&typeof message.enabled==='boolean')view.setSpin(message.enabled);
   else if(a==='filter'&&PRESETS.some(([v])=>v===message.preset)){activePreset=message.preset;view.filter({preset:activePreset});view.fit();publish('ready');}
  }
  function close(){if(closed)return;closed=true;paused=true;epoch++;clearInterval(framePump);aborter.abort();unsubscribe?.();view?.dispose();view=null;for(const track of stream.getTracks())track.stop();stage.remove();}
  unsubscribe=workspace.onClose?.(close);return {stream,handle,close};
 }
 function h(tag,attrs={},...children){const element=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v===null||v===undefined||v===false)continue;if(k.startsWith('on'))element.addEventListener(k.slice(2),v);else element.setAttribute(k,String(v));}for(const c of children.flat())element.append(c?.nodeType?c:document.createTextNode(String(c)));return element;}
 function mount(container,{stream,send,title='Maqueta transmitida',onClose}){
  let disposed=false,ready=false,spin=false,panMode=false,pointer=null,lastMove=0,expanded=!matchMedia('(max-width:700px)').matches;
  const command=(action,extra={})=>{if(!disposed)try{send({op:'model',action,...extra});}catch{report('Se perdió la conexión. Vuelve a abrir la sesión.');}};
  const button=(text,fn,attrs={})=>h('button',{type:'button',...attrs,onclick:fn},text);
  const error=h('p',{class:'mq-error',role:'alert'}),count=h('p',{class:'mq-count',role:'status'},'Preparando el modelo…');
  const video=h('video',{'aria-label':'Modelo transmitido. Arrastra para girar; usa WASD o flechas para desplazar.',playsinline:'',autoplay:'',muted:'',tabindex:'0'});
  video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=stream;video.style.cssText='width:100%;height:100%;object-fit:contain;touch-action:none;display:block';
  const presets=h('div',{class:'mq-presets'}),panel=h('aside',{class:'mq-filters','aria-label':'Filtros de la maqueta transmitida'},h('h2',{},'Filtros'),count,presets);
  panel.hidden=!expanded;
  const toggle=button('Filtros',()=>{expanded=!expanded;panel.hidden=!expanded;toggle.setAttribute('aria-expanded',String(expanded));},{'aria-expanded':expanded});
  function requestClose(){dispose();onClose?.();}
  const heading=h('h1',{},String(title).slice(0,120)),top=h('header',{class:'mq-top'},button('Cerrar maqueta',requestClose),heading,toggle);
  const views=h('select',{'aria-label':'Vista de maqueta',disabled:true,onchange:()=>{command('view',{view:views.value});spin=false;rotate.setAttribute('aria-pressed','false');}},...VIEWS.map(([value,label])=>h('option',{value},label)));
  const fit=button('Encuadrar',()=>command('fit'),{disabled:true}),near=button('+',()=>command('zoom',{factor:.8}),{'aria-label':'Acercar maqueta',disabled:true}),far=button('−',()=>command('zoom',{factor:1.25}),{'aria-label':'Alejar maqueta',disabled:true}),rotate=button('Giro automático',()=>{spin=!spin;command('spin',{enabled:spin});rotate.setAttribute('aria-pressed',String(spin));},{disabled:true,'aria-pressed':'false'});
  function stopSpin(){if(spin)command('spin',{enabled:false});spin=false;rotate.setAttribute('aria-pressed','false');}
  const move=button('Mover vista',()=>{panMode=!panMode;stopSpin();move.setAttribute('aria-pressed',String(panMode));help.textContent=panMode?'Arrastra para mover la vista · Desactiva Mover vista para girar':'Arrastra para girar · Activa Mover vista para desplazar · + y − para acercar';},{disabled:true,'aria-pressed':'false'});
  const play=button('Reproducir modelo',()=>{video.play().then(()=>{play.hidden=true;}).catch(()=>report('Pulsa Reproducir modelo para continuar.'));});
  const retry=button('Reintentar',()=>{error.textContent='';command('open');video.play().catch(()=>{play.hidden=false;});},{hidden:true});
  const camera=h('nav',{class:'mq-camera','aria-label':'Controles de maqueta'},views,fit,near,far,move,rotate),controls=[views,fit,near,far,move,rotate];
  const help=h('p',{class:'mq-help'},'Arrastra para girar · Activa Mover vista para desplazar · + y − para acercar');
  const shell=h('section',{class:'ag-maquette','aria-label':'Maqueta transmitida'},h('div',{class:'mq-stage'},video),top,panel,h('footer',{class:'mq-bottom'},error,retry,play,h('p',{class:'mq-ar-note'},'Modelo transmitido; el original permanece en la computadora.'),help,camera));container.append(shell);
  function report(message){if(!disposed){error.textContent=message;retry.hidden=false;}}
  video.addEventListener('playing',()=>{play.hidden=true;});video.addEventListener('error',()=>report('No se pudo reproducir el modelo transmitido. Vuelve a intentar.'));
  video.addEventListener('pointerdown',event=>{if(!ready)return;video.focus();pointer={id:event.pointerId,x:event.clientX,y:event.clientY};try{video.setPointerCapture(event.pointerId);}catch{}stopSpin();});
  video.addEventListener('pointermove',event=>{if(!pointer||pointer.id!==event.pointerId||!ready)return;const now=performance.now();if(now-lastMove<34)return;lastMove=now;command(panMode?'pan':'orbit',{x:clamp((panMode?-1:1)*(event.clientX-pointer.x)/Math.max(video.clientWidth,1),-.5,.5),y:clamp((panMode?-1:1)*(event.clientY-pointer.y)/Math.max(video.clientHeight,1),-.5,.5)});pointer.x=event.clientX;pointer.y=event.clientY;});
  const pointerEnd=()=>{pointer=null;};video.addEventListener('pointerup',pointerEnd);video.addEventListener('pointercancel',pointerEnd);video.addEventListener('lostpointercapture',pointerEnd);
  video.addEventListener('wheel',event=>{if(!ready)return;event.preventDefault();const now=performance.now();if(now-lastMove<34)return;lastMove=now;command('zoom',{factor:event.deltaY>0?1.1:.9});},{passive:false});
  video.addEventListener('keydown',event=>{if(!ready||event.altKey||event.ctrlKey||event.metaKey)return;const m={w:[0,.12],s:[0,-.12],a:[-.12,0],d:[.12,0],ArrowUp:[0,.12],ArrowDown:[0,-.12],ArrowLeft:[-.12,0],ArrowRight:[.12,0]}[event.key.length===1?event.key.toLowerCase():event.key];if(m){event.preventDefault();stopSpin();command('pan',{x:m[0],y:m[1]});}});
  function handle(message){
   if(disposed||!message||message.op!=='model-state'||!['loading','ready','paused','error'].includes(message.state))return;
   ready=message.state==='ready';for(const c of controls)c.disabled=!ready;
   if(typeof message.title==='string')heading.textContent=message.title.slice(0,120);
   if(message.state==='error'){count.textContent='No se pudo abrir el modelo';report('No se pudo abrir la maqueta en la computadora. Vuelve a intentar.');return;}
   if(message.state==='loading'){count.textContent='Preparando el modelo en la computadora…';retry.hidden=true;error.textContent='';return;}
   if(message.state==='paused'){count.textContent='Modelo en pausa';return;}
   error.textContent='';retry.hidden=true;
   if(Number.isSafeInteger(message.visible)&&Number.isSafeInteger(message.total)&&message.visible>=0&&message.visible<=message.total)count.textContent=message.visible+' de '+message.total+' piezas';
   if(Array.isArray(message.presets)&&message.presets.length<=PRESETS.length){presets.replaceChildren();for(const p of message.presets){const allowed=PRESETS.find(([value])=>value===p?.value);if(!allowed||!Number.isSafeInteger(p.count)||p.count<0)continue;presets.append(button(allowed[1]+' ('+p.count+')',()=>command('filter',{preset:p.value}),{disabled:p.count===0}));}}
  }
  function dispose(){if(disposed)return;command('pause');disposed=true;video.pause();video.srcObject=null;shell.remove();}
  command('open');video.play().catch(()=>{if(!disposed)play.hidden=false;});return {handle,dispose};
 }
 root.AgelSharedModel={host,mount};
})(typeof window!=='undefined'?window:globalThis);
