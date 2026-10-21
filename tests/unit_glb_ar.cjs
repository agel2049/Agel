const {test}=require('node:test');const assert=require('node:assert/strict');
const THREE=require('./vendor/node_modules/three');
let AR;try{AR=require('../packages/bim/glb-ar.js');}catch{}
function fixture(overrides={}){
 const session=new EventTarget();session.ended=0;session.source={cancelled:0,cancel(){this.cancelled++;}};
 session.requestReferenceSpace=async()=>({});session.requestHitTestSource=async()=>session.source;
 session.end=async()=>{session.ended++;session.dispatchEvent(new Event('end'));};
 const renderer={xr:{enabled:false,isPresenting:false,setReferenceSpaceType(){},getReferenceSpace:()=>({}),async setSession(s){this.isPresenting=true;s.addEventListener('end',()=>{this.isPresenting=false;});}},setAnimationLoop(fn){this.loop=fn;},render(){this.renders=(this.renders||0)+1;},getClearAlpha:()=>1,setClearAlpha(){}};
 const scene=new THREE.Scene();scene.background=new THREE.Color('#101214');const model=new THREE.Group();scene.add(model);const camera=new THREE.PerspectiveCamera();camera.position.set(3,4,5);const controls={enabled:true,target:new THREE.Vector3(1,2,3),update(){}};
 let requests=0;const xr={isSessionSupported:async()=>true,async requestSession(){requests++;return session;},...overrides};
 const states=[],config={three:THREE,xr,secure:true,renderer,scene,model,camera,controls,bounds:new THREE.Box3(new THREE.Vector3(-10,-2,-5),new THREE.Vector3(10,2,5)),onState:s=>states.push(s),draw(){}};
 return {session,renderer,scene,model,camera,controls,states,config,xr,get requests(){return requests;}};
}
test('AR is capability checked without requesting a camera; permission denial recovers',async()=>{
 assert.equal(typeof AR?.create,'function');
 const f=fixture({requestSession:async()=>{throw Object.assign(Error(),{name:'NotAllowedError'});}}),ar=AR.create(f.config);
 assert.equal(await ar.supported(),true);assert.equal(f.requests,0);
 await assert.rejects(ar.start(),/cámara/i);assert.equal(f.controls.enabled,true);assert.equal(f.model.visible,true);
 assert.equal(f.scene.children.length,1);ar.dispose();
});
test('AR places the filtered model above a surface, resizes, repositions and restores desktop',async()=>{
 assert.equal(typeof AR?.create,'function');const f=fixture(),ar=AR.create(f.config),before=f.model.matrix.toArray();
 await ar.start();assert.equal(f.model.visible,false);assert.equal(f.controls.enabled,false);
 const pose=new THREE.Matrix4().makeTranslation(2,0,-2).toArray();
 f.renderer.loop(0,{getHitTestResults:()=>[{getPose:()=>({transform:{matrix:pose}})}]});
 f.session.dispatchEvent(new Event('select'));assert.equal(f.model.visible,true);
 assert.equal(f.model.matrix.elements[13],.1);assert.equal(f.model.matrix.elements[0],.05);
 ar.setSize(.5);assert.equal(f.model.matrix.elements[0],.025);ar.rotate();
 ar.reposition();assert.equal(f.model.visible,false);
 f.session.dispatchEvent(new Event('select'));assert.equal(f.model.visible,false,'cannot place with a stale hit after reposition');
 await ar.end();assert.deepEqual(f.model.matrix.toArray(),before);assert.equal(f.model.visible,true);assert.equal(f.controls.enabled,true);assert.equal(f.renderer.loop,null);assert.equal(f.scene.children.length,1);assert.equal(f.session.source.cancelled,1);
 assert.deepEqual(f.camera.position.toArray(),[3,4,5]);assert.deepEqual(f.controls.target.toArray(),[1,2,3]);
 ar.dispose();
});
test('session arriving after dispose is ended and never mounted',async()=>{
 assert.equal(typeof AR?.create,'function');let resolve;const f=fixture({requestSession:()=>new Promise(r=>resolve=r)}),ar=AR.create(f.config);
 const p=ar.start();ar.dispose();resolve(f.session);await assert.rejects(p,/cerr|cancel/i);
 assert.equal(f.session.ended,1);assert.equal(f.renderer.xr.isPresenting,false);assert.equal(f.scene.children.length,1);
});
test('missing hit test and session ending during initialization leave no residual model transform',async()=>{
 assert.equal(typeof AR?.create,'function');const f=fixture(),ar=AR.create(f.config);f.session.requestHitTestSource=async()=>{throw Error('unsupported');};
 await assert.rejects(ar.start());assert.equal(f.session.ended,1);assert.equal(f.model.visible,true);assert.equal(f.controls.enabled,true);assert.equal(f.scene.children.length,1);ar.dispose();
});
test('end during reference-space initialization cancels late setup',async()=>{
 const f=fixture();let resolve;f.session.requestReferenceSpace=()=>new Promise(r=>resolve=r);const ar=AR.create(f.config),p=ar.start();
 await Promise.resolve();await f.session.end();resolve({});await assert.rejects(p,/cancel/i);
 assert.equal(f.scene.children.length,1);assert.equal(f.model.visible,true);assert.equal(f.controls.enabled,true);ar.dispose();
});
test('a hit is required, vertical surfaces are ignored and piece visibility is preserved',async()=>{
 const f=fixture(),child=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());child.layers.disable(0);f.model.add(child);const ar=AR.create(f.config);
 await ar.start();f.renderer.loop(0,{getHitTestResults:()=>[]});f.session.dispatchEvent(new Event('select'));assert.equal(f.model.visible,false);
 const vertical=new THREE.Matrix4().makeRotationX(Math.PI/2).toArray();f.renderer.loop(0,{getHitTestResults:()=>[{getPose:()=>({transform:{matrix:vertical}})}]});f.session.dispatchEvent(new Event('select'));assert.equal(f.model.visible,false);
 const horizontal=new THREE.Matrix4().makeTranslation(0,0,-1).toArray();f.renderer.loop(0,{getHitTestResults:()=>[{getPose:()=>({transform:{matrix:horizontal}})}]});f.session.dispatchEvent(new Event('select'));assert.equal(f.model.visible,true);assert.equal(child.layers.mask,0);
 await ar.end();assert.equal(child.layers.mask,0);ar.dispose();child.geometry.dispose();child.material.dispose();
});
test('a late canceled permission cannot clean up a newer session',async()=>{
 let resolve;const old=fixture(),f=fixture();let calls=0;
 f.xr.requestSession=()=>++calls===1?new Promise(r=>resolve=r):Promise.resolve(f.session);
 const ar=AR.create(f.config),first=ar.start();await ar.end();await ar.start();
 resolve(old.session);await assert.rejects(first,/cancel/i);
 assert.equal(old.session.ended,1);assert.equal(f.session.source.cancelled,0);assert.equal(f.renderer.xr.isPresenting,true);
 await ar.end();assert.equal(f.session.ended,1);assert.equal(f.renderer.xr.isPresenting,false);ar.dispose();
});
test('AR uses physical clip distances and restores model-unit clip distances',async()=>{
 const f=fixture();f.camera.near=5;f.camera.far=500000;const ar=AR.create(f.config);
 await ar.start();assert.equal(f.camera.near,.01);assert.equal(f.camera.far,100);
 await ar.end();assert.equal(f.camera.near,5);assert.equal(f.camera.far,500000);ar.dispose();
});
test('canceled initialization restores the actual Three r128 XR manager after its late continuation',async()=>{
 const fs=require('node:fs'),path=require('node:path'),base=path.dirname(require.resolve('three/package.json',{paths:[path.join(__dirname,'vendor')]}));
 const read=file=>fs.readFileSync(path.join(base,'src',file),'utf8').replace(/^import .*;\s*$/gm,'').replace(/^export .*;\s*$/gm,'');
 const WebGLAnimation=Function(read('renderers/webgl/WebGLAnimation.js')+';return WebGLAnimation;')();
 const WebXRManager=Function('ArrayCamera','EventDispatcher','PerspectiveCamera','Vector3','Vector4','WebGLAnimation',read('renderers/webxr/WebXRManager.js')+';return WebXRManager;')(THREE.ArrayCamera,THREE.EventDispatcher,THREE.PerspectiveCamera,THREE.Vector3,THREE.Vector4,WebGLAnimation);
 const f=fixture();let resolveLocal,entered;const waiting=new Promise(r=>entered=r);let frames=0;
 f.session.requestReferenceSpace=type=>type==='viewer'?Promise.resolve({}):new Promise(r=>{resolveLocal=r;entered();});
 f.session.updateRenderState=()=>{};f.session.requestAnimationFrame=()=>++frames;f.session.cancelAnimationFrame=()=>{frames--;};
 f.renderer.state={bindXRFramebuffer(){}};f.renderer.getRenderTarget=()=>null;f.renderer.setRenderTarget=()=>{};
 f.renderer.xr=new WebXRManager(f.renderer,{getContextAttributes:()=>({xrCompatible:true})});
 let ended=false;f.session.end=async()=>{if(ended)return;ended=true;f.session.ended++;f.session.dispatchEvent(new Event('end'));};
 global.XRWebGLLayer=class{};
 let draws=0;f.config.draw=()=>{draws++;};
 const ar=AR.create(f.config),start=ar.start();await waiting;await ar.end();
 await assert.rejects(ar.start(),/abriendo/,'renderer setup must finish before starting another session');
 resolveLocal({});await assert.rejects(start,/cancel/i);
 assert.equal(f.renderer.xr.isPresenting,false);assert.equal(f.renderer.xr.enabled,false);assert.equal(f.renderer.loop,null);assert.equal(frames,0,'late animation must be stopped');assert.equal(f.renderer.xr.getSession(),null);assert.ok(draws>0);
 ar.dispose();delete global.XRWebGLLayer;
});
