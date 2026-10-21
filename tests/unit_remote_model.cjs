const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Filters=require('../packages/bim/glb-filters.js');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({deferred=false,ref='agel-local:own',owned=true}={}){
 const sent=[],calls=[],paint=[],track={stopped:false,stop(){this.stopped=true;},requestFrame(){}};let loads=0,resolveOpen,frame,now=1000;
 const stream={getTracks:()=>[track]},canvas={width:0,height:0,captureStream:f=>{assert.equal(f,15);return stream;},getContext:()=>({fillRect(){},drawImage(c){paint.push(c);},fillText(t){paint.push(t);},save(){},restore(){},measureText:()=>({width:220})})};
 const element=()=>({style:{},append(){},remove(){this.removed=true;},setAttribute(){}}),container=element();
 const elements=[{id:'secretid',name:'private name',bucket:'mep',geometry:[1,2]},{id:'b',bucket:'masonry'},{id:'c',bucket:'finishes'}];
 const viewer={elements,fit:()=>calls.push(['fit']),setView:v=>calls.push(['view',v]),zoom:v=>calls.push(['zoom',v]),pan:(x,y)=>calls.push(['pan',x,y]),orbit:(x,y)=>calls.push(['orbit',x,y]),setSpin:v=>calls.push(['spin',v]),filter:o=>{calls.push(['filter',o]);return Filters.select(elements,o);},dispose:()=>calls.push(['dispose'])};
 const draft={showroom:{model3d:{url:ref,title:'Mi maqueta'}},media:owned?[{ref:'agel-local:own',kind:'glb'}]:[]};
 const workspace={load:async()=>{loads++;return draft;},store:{get:async value=>{assert.equal(value,'agel-local:own');return {blob:new Blob(['GLB local'],{type:'model/gltf-binary'})};}},onClose:fn=>{workspace.closed=fn;return()=>{};}};
 const context={Blob,URL,AbortController,Date:{now:()=>now},document:{createElement:tag=>tag==='canvas'?canvas:element()},AgelGLBFilters:Filters,AgelGLB:{open:async(stage,opts)=>{calls.push(['open']);frame=opts.onFrame;if(deferred)await new Promise(r=>resolveOpen=r);return viewer;}},console};context.window=context;
 try{vm.runInNewContext(fs.readFileSync(require.resolve('../packages/sharing/remote-model.js'),'utf8'),context);}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
 return {api:context.AgelSharedModel,workspace,container,sent,calls,paint,track,stream,viewer,canvas,get loads(){return loads;},advance(){now+=1100;},resolve(){resolveOpen();},frame:()=>frame?.({tag:'rendered-frame'})};
}
function host(f){assert.equal(typeof f.api?.host,'function');return f.api.host({workspace:f.workspace,container:f.container,sessionId:'abcdefgh-1234',send:m=>f.sent.push(m)});}
test('host returns a video stream immediately and loads only its own GLB after open',async()=>{
 const f=fixture(),h=host(f);assert.equal(h.stream,f.stream);assert.equal(f.loads,0);assert.deepEqual([f.canvas.width,f.canvas.height],[720,480]);h.handle({op:'model',action:'open'});await tick();assert.equal(f.calls.filter(c=>c[0]==='open').length,1);assert.equal(f.sent.at(-1).state,'ready');h.close();assert.equal(f.track.stopped,true);
});
test('host composites a rendered frame with session watermark pixels and shares counts only',async()=>{
 const f=fixture(),h=host(f);h.handle({op:'model',action:'open'});await tick();f.frame();assert.ok(f.paint.some(p=>p.tag==='rendered-frame'));assert.ok(f.paint.includes('AgelArq · Sesión abcdefgh'));const state=f.sent.at(-1);assert.equal(state.total,3);assert.equal(state.presets.find(p=>p.value==='mep').count,1);assert.equal(JSON.stringify(state).includes('secretid'),false);assert.equal(JSON.stringify(state).includes('private name'),false);h.close();
});
test('remote controls whitelist presets and views, clamp finite numbers and rate limit requests',async()=>{
 const f=fixture(),h=host(f);h.handle({op:'model',action:'open'});await tick();f.advance();h.handle({op:'model',action:'orbit',x:100,y:-100});h.handle({op:'model',action:'zoom',factor:100});h.handle({op:'model',action:'view',view:'evil'});h.handle({op:'model',action:'filter',preset:'mep',geometry:[1]});h.handle({op:'model',action:'pan',x:NaN,y:0});assert.ok(f.calls.some(c=>c[0]==='orbit'&&c[1]===.5&&c[2]===-.5));assert.ok(f.calls.some(c=>c[0]==='zoom'&&c[1]===2));assert.equal(f.calls.filter(c=>c[0]==='view').length,0);assert.equal(f.calls.filter(c=>c[0]==='filter').length,0);f.advance();const before=f.calls.filter(c=>c[0]==='pan').length;for(let i=0;i<100;i++)h.handle({op:'model',action:'pan',x:.1,y:0});assert.ok(f.calls.filter(c=>c[0]==='pan').length-before<=60);h.close();
});
test('pause halts rotation and compositing while preserving the negotiated video track',async()=>{
 const f=fixture(),h=host(f);h.handle({op:'model',action:'open'});await tick();h.handle({op:'model',action:'spin',enabled:true});h.handle({op:'model',action:'pause'});const before=f.paint.length;f.frame();assert.equal(f.paint.length,before);assert.equal(f.track.stopped,false);assert.ok(f.calls.some(c=>c[0]==='spin'&&c[1]===false));h.handle({op:'model',action:'open'});await tick();assert.equal(f.calls.filter(c=>c[0]==='open').length,1);h.close();
});
test('closing while GLB initializes disposes its late renderer and stops the stream once',async()=>{
 const f=fixture({deferred:true}),h=host(f);h.handle({op:'model',action:'open'});await tick();h.close();f.resolve();await tick();assert.equal(f.calls.filter(c=>c[0]==='dispose').length,1);assert.equal(f.sent.some(s=>s.state==='ready'),false);assert.equal(f.track.stopped,true);h.close();
});
test('a receiver supplied URL and unowned or executable source references never open a GLB',async()=>{
 for(const options of [{owned:false},{ref:'javascript:alert(1)'},{ref:'https://user:pass@example.test/model.glb'},{ref:'https://example.test/index.html'}]){const f=fixture(options),h=host(f);h.handle({op:'model',action:'open'});await tick();assert.equal(f.calls.filter(c=>c[0]==='open').length,0);assert.equal(f.sent.at(-1).state,'error');h.close();}
 const f=fixture(),h=host(f);h.handle({op:'model',action:'open',url:'https://evil.test/model.glb'});await tick();assert.equal(f.loads,0);h.close();
});
