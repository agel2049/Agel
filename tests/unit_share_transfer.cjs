const test=require('node:test'),assert=require('node:assert/strict');
const {MessageChannel}=require('node:worker_threads');
const fs=require('node:fs'),vm=require('node:vm');
const T=require('../packages/sharing/transfer.js');
const tick=()=>new Promise(r=>setTimeout(r,15));
class Channel extends EventTarget {
  constructor(){super();this.readyState='open';this.bufferedAmount=0;this.maxMessageSize=8192;this.sent=[];}
  send(data){if(this.readyState!=='open')throw Error('closed');this.sent.push(data);queueMicrotask(()=>this.other.dispatchEvent(new MessageEvent('message',{data})));}
  close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'));this.other.readyState='closed';this.other.dispatchEvent(new Event('close'));}
}
function setup(t,blob=new Blob(['0123456789'],{type:'video/mp4'}),extra={}){
  const a=new Channel(),b=new Channel();a.other=b;b.other=a;
  const host=T.serve(a,{assets:new Map([['asset',{getBlob:async()=>blob}],...Object.entries(extra)])});
  const guest=T.receive(b,{});t.after(()=>{guest.close();host.close();});return {a,b,host,guest};
}
function open(guest,asset='asset',range=null){
  const {port1,port2}=new MessageChannel(),messages=[],waiters=[];
  port1.on('message',m=>waiters.length?waiters.shift()(m):messages.push(m));
  guest.pipe(asset,range,port2);
  return {port:port1,next:()=>messages.length?Promise.resolve(messages.shift()):new Promise(r=>waiters.push(r)),close:()=>port1.close()};
}
async function collect(p){const first=await p.next(),chunks=[];if(first.op==='error')return {first,chunks};for(;;){p.port.postMessage({op:'pull'});const m=await p.next();if(m.op==='chunk')chunks.push(Buffer.from(m.chunk));else {p.close();return {first,chunks,last:m};}}}
test('full, explicit, open and suffix ranges deliver exact bytes and HTTP headers',async t=>{
  const {guest}=setup(t);
  for(const [range,status,body,contentRange] of [[null,200,'0123456789',undefined],['bytes=2-5',206,'2345','bytes 2-5/10'],['bytes=7-',206,'789','bytes 7-9/10'],['bytes=-3',206,'789','bytes 7-9/10'],['bytes=8-80',206,'89','bytes 8-9/10']]){
    const result=await collect(open(guest,'asset',range));assert.equal(result.first.status,status);assert.equal(Buffer.concat(result.chunks).toString(),body);assert.equal(result.first.headers['Content-Range'],contentRange);assert.equal(result.first.headers['Content-Length'],String(body.length));assert.equal(result.first.headers['Cache-Control'],'no-store');assert.equal(result.first.headers['X-Content-Type-Options'],'nosniff');assert.equal(result.last.op,'end');
  }
});
test('invalid or unsatisfiable ranges return 416 without reading bytes',async t=>{
  const {guest}=setup(t);
  for(const range of ['bytes=10-','bytes=5-2','bytes=-0','bytes=0-1,4-5','bytes=9007199254740992-','nonsense']){const result=await collect(open(guest,'asset',range));assert.equal(result.first.status,416);assert.equal(result.first.headers['Content-Range'],'bytes */10');assert.equal(result.first.headers['Content-Length'],'0');assert.equal(result.chunks.length,0);}
});
test('empty files produce empty 200 and ranged 416',async t=>{
 const {guest}=setup(t,new Blob([],{type:'image/png'}));for(const [range,status] of [[null,200],['bytes=0-',416],['bytes=-1',416]]){const r=await collect(open(guest,'asset',range));assert.equal(r.first.status,status);assert.equal(r.chunks.length,0);}
});
test('large media reads only the requested slice without truncating above 4 GiB',async t=>{
 const reads=[],blob={size:4294967306,type:'video/mp4',slice(start,end){reads.push([start,end]);return new Blob(['abcde'.slice(0,end-start)]);},arrayBuffer(){throw Error('whole media read');}};
 const {guest}=setup(t,blob),p=open(guest,'asset','bytes=4294967301-');assert.equal((await p.next()).headers['Content-Range'],'bytes 4294967301-4294967305/4294967306');assert.equal(reads.length,0);p.port.postMessage({op:'pull'});assert.equal(Buffer.from((await p.next()).chunk).toString(),'abcde');assert.deepEqual(reads,[[4294967301,4294967306]]);p.close();
});
test('pull sends bounded binary frames and cancel stops subsequent reads',async t=>{
 let reads=0;const original=new Blob([new Uint8Array(150000)],{type:'video/mp4'});const blob={size:original.size,type:original.type,slice(a,b){reads++;return original.slice(a,b);}};
 const {guest,a}=setup(t,blob),p=open(guest);await p.next();await tick();assert.equal(reads,0);p.port.postMessage({op:'pull'});const chunk=await p.next();assert.equal(chunk.op,'chunk');assert.ok(chunk.chunk.byteLength<=8188);assert.ok(a.sent.some(m=>m instanceof ArrayBuffer));p.port.postMessage({op:'cancel'});await tick();assert.equal(reads,1);p.close();
});
test('unknown resources, executable MIME and metadata over 4 MiB are refused',async t=>{
 const {guest}=setup(t,new Blob(['<html>'],{type:'text/html'}),{manifest:{getBlob:async()=>new Blob([new Uint8Array(4194305)],{type:'application/json'})}});
 for(const id of ['missing','asset']){const p=open(guest,id);assert.equal((await p.next()).op,'error');p.close();}await assert.rejects(guest.fetchBlob('manifest'),/large|límite|tamaño|metadata/i);
});
test('fetchBlob collects a bounded manifest and rejects a caller limit before reading',async t=>{
 const {guest}=setup(t,new Blob(['0123456789'],{type:'image/png'}),{manifest:{getBlob:async()=>new Blob(['{"snapshot":{},"expiresAt":1}'],{type:'application/json'})}});
 assert.equal(await (await guest.fetchBlob('manifest')).text(),'{"snapshot":{},"expiresAt":1}');await assert.rejects(guest.fetchBlob('asset',5),/large|límite|tamaño/i);
});
test('disconnect and explicit close promptly fail pending ports and release deferred reads',async t=>{
 let resolve;const {guest,a}=setup(t,{size:50,type:'video/mp4',slice(){return {arrayBuffer:()=>new Promise(r=>{resolve=r;})};}}),p=open(guest);await p.next();p.port.postMessage({op:'pull'});await tick();a.close();assert.equal((await p.next()).op,'error');resolve(new ArrayBuffer(50));p.close();
});
test('request limit rejects the seventeenth concurrent request and cancellation frees a slot',async t=>{
 const {guest}=setup(t),ports=[];for(let i=0;i<16;i++){const p=open(guest);ports.push(p);assert.equal((await p.next()).op,'headers');}const overflow=open(guest);assert.equal((await overflow.next()).op,'error');overflow.close();ports[0].port.postMessage({op:'cancel'});await tick();const next=open(guest);assert.equal((await next.next()).op,'headers');for(const p of [...ports,next])p.close();
});
test('backpressure waits without queueing beyond 1 MiB and close releases blocked send',async t=>{
 const {guest,a}=setup(t,new Blob([new Uint8Array(100000)],{type:'video/mp4'})),p=open(guest);await p.next();a.bufferedAmount=1048576;p.port.postMessage({op:'pull'});await tick();assert.equal(a.sent.filter(x=>x instanceof ArrayBuffer).length,0);a.close();assert.equal((await p.next()).op,'error');p.close();
});
test('an invalid response cancels the host request so the slot is reusable',async t=>{
 const {guest,b}=setup(t),p=open(guest);await p.next();const request=JSON.parse(b.sent.find(x=>typeof x==='string'&&JSON.parse(x).op==='request'));
 b.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({op:'headers',id:request.id,status:200,headers:{'Content-Type':'text/html','Content-Length':'1'}})}));assert.equal((await p.next()).op,'error');await tick();assert.ok(b.sent.some(x=>typeof x==='string'&&JSON.parse(x).op==='cancel'&&JSON.parse(x).id===request.id));p.close();
});
test('progress identifies the asset on both ends after a bounded read',async t=>{
 const a=new Channel(),b=new Channel();a.other=b;b.other=a;const hostProgress=[],guestProgress=[];
 const host=T.serve(a,{assets:new Map([['asset',{getBlob:async()=>new Blob(['abc'],{type:'image/png'})}]]),onProgress:p=>hostProgress.push(p)}),guest=T.receive(b,{onProgress:p=>guestProgress.push(p)});t.after(()=>{guest.close();host.close();});await collect(open(guest));assert.deepEqual(hostProgress,[{asset:'asset',bytes:3}]);assert.deepEqual(guestProgress,[{asset:'asset',bytes:3}]);
});
test('model controls share the channel without closing media; other idless messages are rejected',async t=>{
 const {guest,b}=setup(t);for(const op of ['model','model-state'])b.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({op,action:'open'})}));const result=await collect(open(guest));assert.equal(result.first.status,200);assert.equal(Buffer.concat(result.chunks).toString(),'0123456789');b.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({op:'unexpected'})}));const p=open(guest);assert.equal((await p.next()).op,'error');p.close();
});
function worker(){const events={},clients=new Map();const context={URL,Response,Request,Headers,ReadableStream,MessageChannel,ArrayBuffer,Uint8Array,setTimeout,clearTimeout,console,self:{location:{href:'https://example.test/apps/share/media-worker.js'},clients:{get:async id=>clients.get(id),matchAll:async()=>[...clients.values()],claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>{events[name]=fn;}}};vm.runInNewContext(fs.readFileSync(require.resolve('../apps/share/media-worker.js'),'utf8'),context);return {events,clients};}
const session='11111111-1111-4111-8111-111111111111',asset='22222222-2222-4222-8222-222222222222';
test('worker streams media using a live session owner and rejects missing bindings and executable paths',async()=>{
 const {events,clients}=worker();let fetches=0,cancels=0;
 const client={id:'owner',url:'https://example.test/apps/share/index.html',postMessage(message,ports){if(message.type==='agel-share-probe'){ports[0].postMessage({active:false});ports[0].close();return;}fetches++;assert.equal(message.type,'agel-share-fetch');assert.equal(message.asset,asset);assert.equal(message.range,'bytes=2-4');const p=ports[0];p.on('message',m=>{if(m.op==='pull'){p.postMessage({op:'chunk',chunk:new Uint8Array([2,3,4]).buffer});p.postMessage({op:'end'});}if(m.op==='cancel'){cancels++;p.close();}});p.postMessage({op:'headers',status:206,headers:{'Content-Type':'video/mp4','Content-Length':'3','Content-Range':'bytes 2-4/10'}});}};clients.set('owner',client);
 const request=async(path,opts={})=>{let response;events.fetch({request:new Request('https://example.test/apps/share/media/'+path,{headers:{Range:'bytes=2-4'},...opts}),clientId:'owner',respondWith:p=>{response=p;}});return response;};
 assert.equal((await request(session+'/'+asset+'.mp4')).status,410);events.message({data:{type:'agel-share-bind',session},source:client});const r=await request(session+'/'+asset+'.mp4');assert.equal(r.status,206);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[2,3,4]);assert.equal(fetches,1);assert.equal(await request(session+'/'+asset+'.html'),undefined);events.message({data:{type:'agel-share-unbind',session},source:client});assert.equal((await request(session+'/'+asset+'.mp4')).status,410);assert.equal(cancels,0);
});
test('worker unbind aborts pending headers and a streaming body, and cannot be spoofed by another tab',async()=>{
 for(const headers of [false,true]){
  const {events,clients}=worker();let remote,cancelled;const cancellation=new Promise(r=>{cancelled=r;});
  const client={id:'owner',url:'https://example.test/apps/share/index.html',postMessage(m,ports){remote=ports[0];remote.on('message',m=>{if(m.op==='cancel'){cancelled();remote.close();}});if(headers)remote.postMessage({op:'headers',status:200,headers:{'Content-Type':'video/mp4','Content-Length':'100'}});}};clients.set(client.id,client);events.message({data:{type:'agel-share-bind',session},source:client});let response;events.fetch({request:new Request('https://example.test/apps/share/media/'+session+'/'+asset+'.mp4'),clientId:client.id,respondWith:p=>{response=p;}});await tick();
  events.message({data:{type:'agel-share-unbind',session},source:{id:'intruder',url:client.url}});events.message({data:{type:'agel-share-unbind',session},source:client});const result=await response;if(headers)await assert.rejects(result.arrayBuffer(),/terminó/);else assert.equal(result.status,410);await cancellation;
 }
});
test('worker allows a bound PDF navigation and propagates body cancellation without persistence',async()=>{
 const {events,clients}=worker();let cancelled;const cancellation=new Promise(r=>{cancelled=r;});
 const client={id:'owner',url:'https://example.test/apps/share/index.html',postMessage(m,ports){const port=ports[0];port.on('message',m=>{if(m.op==='cancel'){cancelled();port.close();}});port.postMessage({op:'headers',status:200,headers:{'Content-Type':'application/pdf','Content-Length':'100'}});}};clients.set('owner',client);events.message({data:{type:'agel-share-bind',session},source:client});
 const request=new Request('https://example.test/apps/share/media/'+session+'/'+asset+'.pdf');Object.defineProperty(request,'mode',{value:'navigate'});let response;events.fetch({request,clientId:'',respondWith:p=>{response=p;}});const result=await response;assert.equal(result.status,200);await result.body.cancel();await cancellation;
});

test('a restarted worker recovers only its live receiver, preserves client isolation and cannot revive a closed session',async()=>{
 const {events,clients}=worker();let active=true,probes=0;
 const client={id:'owner',url:'https://example.test/apps/share/',postMessage(m,ports){const p=ports[0];if(m.type==='agel-share-probe'){probes++;p.postMessage({active:active&&m.session===session});p.close();return;}p.on('message',m=>{if(m.op==='pull'){p.postMessage({op:'chunk',chunk:new Uint8Array([7]).buffer});p.postMessage({op:'end'});p.close();}});p.postMessage({op:'headers',status:200,headers:{'Content-Type':'image/jpeg','Content-Length':'1'}});}};
 clients.set(client.id,client);
 const request=async id=>{let response;events.fetch({request:new Request('https://example.test/apps/share/media/'+session+'/'+asset+'.jpg'),clientId:id,respondWith:p=>{response=p;}});return response;};
 assert.equal((await request('intruder')).status,403);const response=await request(client.id);assert.equal(response.status,200);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[7]);assert.equal(probes,1);
 active=false;events.message({data:{type:'agel-share-unbind',session},source:client});assert.equal((await request(client.id)).status,410);
});
test('a restarted worker recovers PDF navigation but refuses ambiguous ownership',async()=>{
 for(const count of [1,2]){
  const {events,clients}=worker();for(let i=0;i<count;i++)clients.set('owner'+i,{id:'owner'+i,url:'https://example.test/apps/share/',postMessage(m,ports){ports[0].postMessage(m.type==='agel-share-probe'?{active:true}:{op:'headers',status:200,headers:{'Content-Type':'application/pdf','Content-Length':'0'}});ports[0].close();}});
  const request=new Request('https://example.test/apps/share/media/'+session+'/'+asset+'.pdf');Object.defineProperty(request,'mode',{value:'navigate'});let response;events.fetch({request,clientId:'',respondWith:p=>{response=p;}});assert.equal((await response).status,count===1?200:410);
 }
});
