/* AR session ownership. Models stay in this page; no uploads or credentials. */
(function(root){
 'use strict';
 const math=typeof module!=='undefined'&&module.exports?require('./maquette-math.js'):root.AgelMaquetteMath;
 function create({renderer,scene,camera,model,bounds,controls,onState=()=>{},draw=()=>{},three: T=root.THREE,xr=root.navigator?.xr,secure=root.isSecureContext}){
  let session=null,source=null,reticle=null,saved=null,overlay=null,closed=false,busy=false,settingUp=false,live=false,nonce=0,anchor=null,size=1,rotation=0;
  const extent=Math.max(...bounds.getSize(new T.Vector3()).toArray());math.scaleFor(extent,size);
  const emit=(state,message)=>{if(!closed)onState({state,message,overlay:!!session?.domOverlayState});};
  const cancelled=()=>Object.assign(Error('Visor cerrado o sesión cancelada.'),{name:'AbortError'});
  async function supported(){try{return !closed&&!!secure&&!!xr&&await xr.isSessionSupported('immersive-ar');}catch{return false;}}
  function apply(){if(!anchor)return;const scale=math.scaleFor(extent,size);model.matrix.copy(anchor).multiply(new T.Matrix4().makeRotationY(rotation)).scale(new T.Vector3(scale,scale,scale)).multiply(new T.Matrix4().makeTranslation(0,-bounds.min.y,0));model.matrixWorldNeedsUpdate=true;}
  function select(){if(!live||anchor||!reticle?.visible)return;anchor=reticle.matrix.clone();apply();model.visible=true;reticle.visible=false;emit('placed','Maqueta colocada. Muévete alrededor para explorar.');}
  function beforeSelect(event){if(event.target?.closest?.('button,input,select,a,summary'))event.preventDefault();}
  function cleanup(){
   nonce++;busy=false;live=false;
   source?.cancel();source=null;
   session?.removeEventListener('select',select);session?.removeEventListener('end',cleanup);session=null;
   overlay?.removeEventListener('beforexrselect',beforeSelect);overlay=null;
   if(reticle){scene.remove(reticle);reticle.geometry.dispose();reticle.material.dispose();reticle=null;}
   if(saved){
    renderer.setAnimationLoop(null);renderer.xr.enabled=false;renderer.setClearAlpha(saved.alpha);scene.background=saved.background;
    model.matrix.copy(saved.matrix);model.matrixAutoUpdate=saved.auto;model.visible=saved.visible;model.matrixWorldNeedsUpdate=true;
    camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);camera.up.copy(saved.up);camera.near=saved.near;camera.far=saved.far;camera.updateProjectionMatrix();
    controls.target.copy(saved.target);controls.enabled=saved.controls;controls.update();saved=null;
   }
   anchor=null;rotation=0;emit('idle','');queueMicrotask(draw);
  }
  function tick(_time,frame){
   if(!live||closed||!frame)return;
   if(!anchor){
    reticle.visible=false;
    try{const hits=frame.getHitTestResults(source),pose=hits[0]?.getPose(renderer.xr.getReferenceSpace()),m=pose?.transform.matrix;
     if(m?.length===16&&Array.from(m).every(Number.isFinite)&&m[5]>.85){reticle.matrix.fromArray(m);reticle.visible=true;}
    }catch{/* A frame can lose tracking; the next frame may recover. */}
   }
   renderer.render(scene,camera);
  }
  async function start(rootOverlay){
   if(closed)throw cancelled();if(busy||settingUp||session)throw Error('Ya se está abriendo una sesión de cámara.');
   if(!secure||!xr)throw Error('La cámara AR requiere HTTPS y un dispositivo compatible.');
   busy=true;const ticket=++nonce;emit('starting','Activando cámara…');let acquired;
   const valid=()=>{if(closed||ticket!==nonce)throw cancelled();};
   try{
    const opts={requiredFeatures:['hit-test'],optionalFeatures:['dom-overlay']};if(rootOverlay)opts.domOverlay={root:rootOverlay};
    acquired=await xr.requestSession('immersive-ar',opts);
    valid();session=acquired;session.addEventListener('end',cleanup);session.addEventListener('select',select);
    const ref=await session.requestReferenceSpace('viewer');valid();
    const hit=await session.requestHitTestSource({space:ref});if(closed||ticket!==nonce){hit.cancel();throw cancelled();}source=hit;
    model.updateMatrix();saved={matrix:model.matrix.clone(),auto:model.matrixAutoUpdate,visible:model.visible,background:scene.background,alpha:renderer.getClearAlpha(),position:camera.position.clone(),quaternion:camera.quaternion.clone(),up:camera.up.clone(),near:camera.near,far:camera.far,target:controls.target.clone(),controls:controls.enabled};
    camera.near=.01;camera.far=100;camera.updateProjectionMatrix();
    model.matrixAutoUpdate=false;model.visible=false;controls.enabled=false;scene.background=null;renderer.setClearAlpha(0);
    overlay=rootOverlay;overlay?.addEventListener('beforexrselect',beforeSelect);
    reticle=new T.Mesh(new T.RingGeometry(.065,.085,48).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:0xb89d74,side:T.DoubleSide}));reticle.matrixAutoUpdate=false;reticle.visible=false;scene.add(reticle);
    renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');
    // Three r128 completes setSession after async reference-space setup. Defer its
    // end handler until that continuation finishes so it cannot revive a dead session.
    const deferEnd=event=>event.stopImmediatePropagation();settingUp=true;
    acquired.addEventListener('end',deferEnd);
    try{await renderer.xr.setSession(acquired);}finally{
     acquired.removeEventListener('end',deferEnd);
     if(closed||ticket!==nonce){
      if(renderer.xr.isPresenting)acquired.dispatchEvent(new Event('end'));
      renderer.xr.isPresenting=false;renderer.xr.enabled=false;renderer.setAnimationLoop(null);
      await renderer.xr.setSession(null);queueMicrotask(draw);
     }
     settingUp=false;
    }
    valid();
    busy=false;live=true;renderer.setAnimationLoop(tick);emit('searching','Apunta a una mesa o al suelo. Toca el círculo para colocar la maqueta.');
   }catch(error){
    const owns=ticket===nonce;
    if(acquired){try{await acquired.end();}catch{/* Already ended by the user. */}}
    if(owns&&ticket===nonce)cleanup();
    if(!owns||closed||error.name==='AbortError')throw cancelled();
    const message=error.name==='NotAllowedError'?'No se activó la cámara. Permite su uso en el navegador y vuelve a intentar.':error.name==='NotSupportedError'?'Este dispositivo no permite colocar la maqueta con WebXR. Puedes seguir explorándola en 3D.':error.message==='Visor cerrado o sesión cancelada.'?error.message:'No se pudo iniciar AR. Cierra otra sesión de cámara y vuelve a intentar.';
    emit('error',message);throw Error(message);
   }
  }
  async function end(){const current=session;if(current){try{await current.end();}finally{if(session===current)cleanup();}}else cleanup();}
  return {supported,start,end,reposition(){if(!live)return;anchor=null;model.visible=false;reticle.visible=false;emit('searching','Apunta a otra superficie y toca el círculo para recolocar.');},setSize(value){math.scaleFor(extent,value);size=value;apply();},rotate(){rotation=(rotation+Math.PI/2)%(Math.PI*2);apply();},dispose(){if(closed)return;closed=true;end().catch(()=>{});}};
 }
 let nativeSDK;
 function quickLook({blob,extent,host}){
  let closed=false,element=null,url=null,rejectLoad=null,timeout=null;let ready=false;
  const readyPromise=(async()=>{
   if(!root.customElements.get('model-viewer')){
    if(!nativeSDK)nativeSDK=new Promise((resolve,reject)=>{const script=document.createElement('script');script.type='module';script.src='https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';script.onload=resolve;script.onerror=()=>{script.remove();nativeSDK=null;reject(Error('No se pudo preparar AR. Revisa la conexión y vuelve a intentar.'));};document.head.append(script);});
    await nativeSDK;
   }
   if(closed)throw Error('Visor cerrado.');
   element=document.createElement('model-viewer');element.className='mq-native';element.setAttribute('aria-hidden','true');element.setAttribute('ar','');element.setAttribute('ar-modes','quick-look');element.setAttribute('scale',Array(3).fill(math.scaleFor(extent,1)).join(' '));
   url=URL.createObjectURL(blob);element.setAttribute('src',url);
   await new Promise((resolve,reject)=>{rejectLoad=reject;timeout=setTimeout(()=>reject(Error('No se pudo preparar la maqueta. Vuelve a intentar.')),30000);element.addEventListener('load',resolve,{once:true});element.addEventListener('error',()=>reject(Error('No se pudo preparar la maqueta para iPhone.')),{once:true});host.append(element);}).finally(()=>{clearTimeout(timeout);rejectLoad=null;});
   if(closed)throw Error('Visor cerrado.');if(!element.canActivateAR)throw Error('Este equipo no ofrece Quick Look. Puedes seguir explorando la maqueta en 3D.');ready=true;
  })();
  return {ready:readyPromise,async open(){if(closed||!ready)throw Error('Primero prepara la maqueta para AR.');await element.activateAR();},dispose(){closed=true;clearTimeout(timeout);rejectLoad?.(Error('Visor cerrado.'));element?.remove();if(url){URL.revokeObjectURL(url);url=null;}}};
 }
 const api={create,quickLook};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgelGLBAR=api;
})(typeof window!=='undefined'?window:globalThis);
