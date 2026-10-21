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
