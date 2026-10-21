/* Local GLB rendering using the existing Three.js version, never an upload. */
(function(root){
 'use strict';
 const BASE='https://cdn.jsdelivr.net/npm/three@0.128.0/';let sdk;
 function script(path){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=BASE+path;s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('No se pudo cargar la biblioteca 3D. Revisa la conexión y vuelve a intentar.'));};document.head.append(s);});}
 function loadSDK(){if(sdk)return sdk;sdk=(async()=>{
  if(!root.THREE)await script('build/three.min.js');
  if(String(THREE.REVISION)!=='128')throw Error('La biblioteca 3D cargada no es compatible con este visor.');
  await Promise.all([!THREE.GLTFLoader&&script('examples/js/loaders/GLTFLoader.js'),!THREE.OrbitControls&&script('examples/js/controls/OrbitControls.js'),!THREE.DRACOLoader&&script('examples/js/loaders/DRACOLoader.js'),!root.MeshoptDecoder&&script('examples/js/libs/meshopt_decoder.js')]);
 })().catch(e=>{sdk=null;throw e;});return sdk;}
 function inspect(bytes){
  const d=new DataView(bytes);
  if(bytes.byteLength<20||d.getUint32(0,true)!==0x46546c67||d.getUint32(4,true)!==2||d.getUint32(8,true)!==bytes.byteLength||d.getUint32(16,true)!==0x4e4f534a)throw Error('El archivo no es un GLB 2 válido. Vuelve a exportar el modelo.');
  const length=d.getUint32(12,true);if(length%4||length>bytes.byteLength-20)throw Error('El GLB está incompleto.');
  let json;try{json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));}catch{throw Error('No se pudo leer la estructura del GLB.');}
  for(const b of json.buffers||[])if(b.uri&&!/^data:application\/(octet-stream|gltf-buffer);base64,/i.test(b.uri))throw Error('Usa un GLB autocontenido: contiene recursos externos.');
  for(const image of json.images||[])if(image.uri&&!/^data:image\/(png|jpe?g|webp|ktx2);base64,/i.test(image.uri))throw Error('Usa un GLB autocontenido con texturas embebidas: contiene recursos externos.');
  return json;
 }
 function release(object){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  object?.traverse(n=>{if(n.geometry)geometries.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:[n.material])if(m){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
  for(const t of textures){t.dispose();t.image?.close?.();}for(const m of materials)m.dispose();for(const g of geometries)g.dispose();
 }
 async function open(container,{blob,onARState=()=>{}}){
  if(!(blob instanceof Blob)||!blob.size)throw Error('Elige un archivo GLB del dispositivo.');
  const bytes=await blob.arrayBuffer();inspect(bytes);await loadSDK();
  const draco=new THREE.DRACOLoader();draco.setDecoderPath(BASE+'examples/js/libs/draco/gltf/');
  const loader=new THREE.GLTFLoader();loader.setDRACOLoader(draco);if(root.MeshoptDecoder)loader.setMeshoptDecoder(root.MeshoptDecoder);
  let gltf;try{gltf=await new Promise((resolve,reject)=>loader.parse(bytes,'',resolve,reject));}catch(e){draco.dispose();throw Error('No se pudo leer el GLB: '+(e.message||'formato no compatible'));}
  const model=gltf.scene,meshes=[],elements=[];
  model.traverse(n=>{if(n.geometry&&(n.isMesh||n.isPoints||n.isLine)){const ancestors=[];let p=n.parent;while(p&&p!==model){ancestors.unshift(p);p=p.parent;}meshes.push(n);elements.push(AgelGLBFilters.describe(n,ancestors));}});
  if(!meshes.length){release(model);draco.dispose();throw Error('El GLB no contiene piezas de geometría visibles.');}
  let renderer,controls,observer,frame=0,disposed=false,spin=false,currentView='iso',ar;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#101214');
  const camera=new THREE.PerspectiveCamera(45,1,.01,10000);
  const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3());model.position.sub(center);model.updateMatrixWorld(true);
  const content=new THREE.Group();content.add(model);scene.add(content);
  const centeredBounds=new THREE.Box3().setFromObject(content),extent=centeredBounds.getSize(new THREE.Vector3());
  if(!Number.isFinite(extent.length())||extent.length()<=0){release(model);draco.dispose();throw Error('El modelo no tiene dimensiones válidas.');}
  scene.add(new THREE.HemisphereLight(0xffffff,0x737b89,1.7));
  const key=new THREE.DirectionalLight(0xffffff,1.8);key.position.set(5,9,7);scene.add(key);
  const fill=new THREE.DirectionalLight(0xc4d8ff,.7);fill.position.set(-5,3,-4);scene.add(fill);
  const byId=new Map(meshes.map(m=>[m.uuid,m]));let activeIds=new Set(byId.keys());
  function draw(){if(disposed||frame||renderer?.xr.isPresenting)return;frame=requestAnimationFrame(()=>{frame=0;if(!disposed&&!renderer.xr.isPresenting){if(spin)controls.update();renderer.render(scene,camera);if(spin)draw();}});}
  function fit(ids){
   if(disposed||renderer?.xr.isPresenting)return;const selected=ids?ids.map(id=>byId.get(id)).filter(Boolean):meshes.filter(m=>activeIds.has(m.uuid));if(!selected.length)return;
   const box=new THREE.Box3();for(const m of selected){m.geometry.computeBoundingBox();if(m.geometry.boundingBox)box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));}
   if(box.isEmpty())return;const c=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=Math.max(size.length()/2,.01),distance=radius/Math.sin(camera.fov*Math.PI/360)/Math.min(camera.aspect,1)*1.15;
   const direction=camera.position.clone().sub(controls.target);if(direction.lengthSq()<.001)direction.set(1,.65,1.5);direction.normalize();camera.position.copy(c).addScaledVector(direction,distance);camera.near=Math.max(radius/10000,.0001);camera.far=distance+radius*1000;camera.updateProjectionMatrix();controls.target.copy(c);controls.maxDistance=Math.max(distance*50,100);controls.update();draw();
  }
  function setView(name){if(disposed||renderer.xr.isPresenting)return;const pose=AgelMaquetteMath.view(name);currentView=name;camera.up.fromArray(pose.up);camera.position.copy(controls.target).add(new THREE.Vector3(...pose.direction));fit();}
  function zoom(factor){if(!Number.isFinite(factor)||factor<=0||disposed||renderer.xr.isPresenting)return;const v=camera.position.clone().sub(controls.target);v.multiplyScalar(factor);v.setLength(Math.max(camera.near*3,Math.min(v.length(),controls.maxDistance)));camera.position.copy(controls.target).add(v);controls.update();draw();}
  function setSpin(value){spin=!!value&&!disposed&&!renderer?.xr.isPresenting;if(controls){controls.autoRotate=spin;controls.autoRotateSpeed=.6;}draw();}
  function pan(x,y){if(disposed||renderer.xr.isPresenting||!Number.isFinite(x)||!Number.isFinite(y))return;camera.updateMatrixWorld();const distance=camera.position.distanceTo(controls.target)*Math.tan(camera.fov*Math.PI/360),delta=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(x*distance).add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1).multiplyScalar(y*distance));camera.position.add(delta);controls.target.add(delta);controls.update();draw();}
  function keydown(ev){if(ev.altKey||ev.ctrlKey||ev.metaKey)return;const move={w:[0,.12],s:[0,-.12],a:[-.12,0],d:[.12,0],ArrowUp:[0,.12],ArrowDown:[0,-.12],ArrowLeft:[-.12,0],ArrowRight:[.12,0]}[ev.key.length===1?ev.key.toLowerCase():ev.key];if(move){ev.preventDefault();setSpin(false);pan(...move);}}
  function resize(){if(disposed||renderer?.xr.isPresenting)return;const w=Math.max(container.clientWidth,1),h=Math.max(container.clientHeight,1);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();draw();}
  function dispose(){if(disposed)return;disposed=true;spin=false;ar?.dispose();cancelAnimationFrame(frame);observer?.disconnect();controls?.dispose();renderer?.domElement.removeEventListener('keydown',keydown);release(model);draco.dispose();renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove();}
  try{
   renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;
   renderer.domElement.setAttribute('aria-label','Maqueta 3D. Arrastra para girar; usa WASD o flechas para desplazar la vista.');renderer.domElement.tabIndex=0;renderer.domElement.addEventListener('keydown',keydown);container.append(renderer.domElement);
   controls=new THREE.OrbitControls(camera,renderer.domElement);controls.addEventListener('change',draw);controls.enableDamping=false;
   if(root.AgelGLBAR)ar=AgelGLBAR.create({renderer,scene,camera,model:content,bounds:centeredBounds,controls,onState:s=>{if(s.state==='starting')setSpin(false);onARState(s);},draw:resize});
   observer=new ResizeObserver(resize);observer.observe(container);resize();fit();
  }catch(e){dispose();throw Error('No se pudo iniciar el visor 3D: '+(e.message||'WebGL no disponible'));}
  return {elements,fit,setView,zoom,setSpin,pan,ar,extent:Math.max(...extent.toArray()),snapshot:()=>({view:currentView,spin,position:camera.position.toArray(),target:controls.target.toArray()}),filter(options={}){if(disposed)throw Error('El visor ya se cerró.');const visible=AgelGLBFilters.select(elements,options);activeIds=new Set(visible.map(e=>e.id));for(const m of meshes)activeIds.has(m.uuid)?m.layers.enable(0):m.layers.disable(0);draw();return visible;},dispose};
 }
 root.AgelGLB={open};
})(window);
