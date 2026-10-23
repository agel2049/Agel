const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const projectId='11111111-1111-4111-8111-111111111111',sessionId='22222222-2222-4222-8222-222222222222';
const key=Buffer.alloc(32,7).toString('base64url');
const turn=()=>new Promise(r=>setImmediate(r));
async function until(fn){const deadline=Date.now()+2000;while(!fn()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.ok(fn(),'async operation did not settle');}
function env(){
 const sockets=[],pcs=[],timers=new Map(),events=new Map();let seq=0;
 class WS{constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.();}open(){this.readyState=1;this.onopen?.();}receive(m){this.onmessage?.({data:JSON.stringify(m)});}}
 class PC{constructor(cfg){this.cfg=cfg;this.remoteDescription=null;this.connectionState='new';this.closed=false;this.sctp={maxMessageSize:65536};pcs.push(this);}createDataChannel(label,opts){this.channel={label,...opts,readyState:'connecting',close(){this.readyState='closed';},send(){}};return this.channel;}async createOffer(){return{type:'offer',sdp:'offer-sdp'};}async createAnswer(){return{type:'answer',sdp:'answer-sdp'};}async setLocalDescription(d){this.localDescription=d;}async setRemoteDescription(d){if(this.closed)throw Error('closed');this.remoteDescription=d;}async addIceCandidate(c){(this.ice??=[]).push(c);}close(){this.closed=true;}}
 const cloud={url:'https://example.supabase.co',anonKey:'public-anon',storageKey:'agel.session',user:{id:'user1'},session:{access_token:'jwt1',user:{id:'user1'}},listeners:new Set(),async accessToken(){return this.session?.access_token;},onAuth(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);},change(s){this.session=s;this.user=s?.user;for(const f of this.listeners)f(s);}};
 const ctx={console,crypto:webcrypto,TextEncoder,TextDecoder,URL,Uint8Array,ArrayBuffer,WebSocket:WS,RTCPeerConnection:PC,Date,JSON,Promise,Error,Set,Map,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout:(f,ms)=>{const id=++seq;timers.set(id,{f,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval:(f,ms)=>{const id=++seq;timers.set(id,{f,ms,interval:true});return id;},clearInterval:id=>timers.delete(id),addEventListener:(n,f)=>{if(!events.has(n))events.set(n,new Set());events.get(n).add(f);},removeEventListener:(n,f)=>events.get(n)?.delete(f)};
 ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
 for(const name of ['signal','peer']){const p=`packages/sharing/${name}.js`;if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),ctx);}
 return{ctx,cloud,sockets,pcs,timers,events,opts:{cloud,projectId,sessionId,key},tick(ms){for(const[id,t]of [...timers])if(t.ms===ms){if(!t.interval)timers.delete(id);t.f();}}};
}
async function signal(e,extra={}){const p=e.ctx.AgelShareSignal.open({...e.opts,...extra});p.catch(()=>{});await until(()=>e.sockets.length);const ws=e.sockets.at(-1);ws.open();const join=ws.sent[0];ws.receive({topic:join.topic,event:'phx_reply',ref:join.ref,join_ref:join.join_ref,payload:{status:'ok',response:{}}});return{api:await p,ws,join};}
test('signal authenticates only a private project topic and keeps key/JWT outside URL and broadcast',async()=>{
 const e=env();assert.ok(e.ctx.AgelShareSignal,'signal API missing');const{api,ws,join}=await signal(e);
 assert.equal(new URL(ws.url).searchParams.get('vsn'),'1.0.0');assert.ok(!ws.url.includes('jwt1'));assert.ok(!ws.url.includes(key));assert.equal(join.payload.config.private,true);assert.equal(join.payload.config.presence.enabled,false);assert.equal(join.payload.access_token,'jwt1');assert.equal(join.topic,`realtime:agel-share:${projectId}:${sessionId}`);
 await api.send({type:'offer',sdp:'sensitive SDP'});const m=ws.sent.at(-1);assert.equal(m.event,'broadcast');assert.ok(!JSON.stringify(m).includes('sensitive SDP'));assert.ok(!JSON.stringify(m).includes('jwt1'));assert.ok(!JSON.stringify(m).includes(key));api.close();assert.equal(e.timers.size,0);assert.equal(e.cloud.listeners.size,0);
});
test('AES-GCM authenticates topic/ciphertext and rejects tampering, wrong keys, oversized frames and replay',async()=>{
 const a=env(),b=env(),received=[];const sa=await signal(a),sb=await signal(b,{onMessage:m=>received.push(m)});
 await sa.api.send({type:'hello',from:'one'});const wire=sa.ws.sent.at(-1);sb.ws.receive(wire);await until(()=>received.length===1);assert.equal(received[0].from,'one');sb.ws.receive(wire);await turn();await turn();assert.equal(received.length,1);
 await sa.api.send({type:'hello',from:'tampered'});const corrupt=structuredClone(sa.ws.sent.at(-1));corrupt.payload.payload.data='AAAA';sb.ws.receive(corrupt);sb.ws.receive({...wire,topic:'realtime:other'});sb.ws.receive({...wire,payload:{...wire.payload,payload:{data:'x'.repeat(100000)}}});await sa.api.send({type:'hello',from:'after-invalid'});sb.ws.receive(sa.ws.sent.at(-1));await until(()=>received.length===2);assert.deepEqual(received.map(m=>m.from),['one','after-invalid']);
 const c=env(),wrong=[];const sc=await signal(c,{key:Buffer.alloc(32,8).toString('base64url'),onMessage:m=>wrong.push(m)});sc.ws.receive(wire);await sc.api.send({type:'hello',from:'correct-key-sentinel'});sc.ws.receive(sc.ws.sent.at(-1));await until(()=>wrong.length===1);assert.equal(wrong[0].from,'correct-key-sentinel');await assert.rejects(sa.api.send({sdp:'x'.repeat(40000)}),/grande|large|limit/i);sa.api.close();sb.api.close();sc.api.close();
});
test('invalid session/key and missing authentication never open socket',async()=>{
 const e=env();for(const extra of [{key:'bad'},{projectId:'not-uuid'},{sessionId:'bad'}])await assert.rejects(e.ctx.AgelShareSignal.open({...e.opts,...extra}));e.cloud.change(null);await assert.rejects(e.ctx.AgelShareSignal.open(e.opts));assert.equal(e.sockets.length,0);
});
test('refresh sends token only to Realtime, account change tears down watchers and socket',async()=>{
 const e=env(),closes=[];const{api,ws}=await signal(e,{onClose:r=>closes.push(r)});e.cloud.change({access_token:'jwt2',user:{id:'user1'}});await until(()=>ws.sent.some(m=>m.event==='access_token'));assert.equal(ws.sent.at(-1).payload.access_token,'jwt2');e.cloud.change({access_token:'jwt3',user:{id:'user2'}});assert.equal(ws.readyState,3);assert.equal(e.timers.size,0);assert.equal(e.cloud.listeners.size,0);assert.equal(closes.length,1);api.close();assert.equal(closes.length,1);
});
test('failed private join and unanswered heartbeat close instead of falling back public',async()=>{
 const e=env();const p=e.ctx.AgelShareSignal.open(e.opts);await until(()=>e.sockets.length);const ws=e.sockets[0];ws.open();const j=ws.sent[0];ws.receive({topic:j.topic,event:'phx_reply',ref:j.ref,payload:{status:'error',response:{reason:'denied'}}});await assert.rejects(p);assert.equal(e.sockets.length,1);assert.equal(ws.readyState,3);assert.equal(e.timers.size,0);
 const b=env();const s=await signal(b);b.tick(20000);assert.equal(s.ws.sent.at(-1).event,'heartbeat');b.tick(20000);assert.equal(s.ws.readyState,3);assert.equal(b.timers.size,0);
});
function signalBus(){const clients=[];return async options=>{const c={options,closed:false,send:async m=>{for(const other of clients)if(other!==c&&!other.closed)other.options.onMessage(structuredClone(m));},close(){c.closed=true;}};clients.push(c);return c;};}
test('peer constructors return immediate handles and close a late signal result without creating PC',async()=>{
 const e=env();assert.ok(e.ctx.AgelSharePeer,'peer API missing');let resolve,closed=0;const p=e.ctx.AgelSharePeer.host({...e.opts,expiresAt:Date.now()+100000,signalOpen:()=>new Promise(r=>resolve=r)});assert.equal(typeof p.close,'function');assert.equal(typeof p.ready.then,'function');p.close();await assert.rejects(p.ready);resolve({send:async()=>{},close:()=>closed++});await turn();assert.equal(closed,1);assert.equal(e.pcs.length,0);assert.equal(e.timers.size,0);
});
test('host chooses one guest, ignores outsiders and exposes only an open reliable DataChannel',async()=>{
 const e=env();let opts;const sent=[],channels=[];const handle=e.ctx.AgelSharePeer.host({...e.opts,expiresAt:Date.now()+100000,onChannel:c=>channels.push(c),signalOpen:async o=>{opts=o;return{send:async m=>sent.push(m),close(){}};}});await turn();opts.onMessage({type:'hello',from:'33333333-3333-4333-8333-333333333333'});await until(()=>sent.some(m=>m.type==='offer'));assert.equal(e.pcs.length,1);assert.equal(e.pcs[0].cfg.iceServers[0].urls,'stun:stun.l.google.com:19302');assert.equal(e.pcs[0].channel.ordered,true);assert.equal(channels.length,0);
 opts.onMessage({type:'hello',from:'44444444-4444-4444-8444-444444444444'});await turn();assert.equal(e.pcs.length,1);const offer=sent.find(m=>m.type==='offer');opts.onMessage({type:'answer',from:'44444444-4444-4444-8444-444444444444',to:offer.from,sdp:'bad'});await turn();assert.equal(e.pcs[0].remoteDescription,null);const c=e.pcs[0].channel;c.readyState='open';c.onopen();assert.equal(await handle.ready,c);assert.equal(channels.length,1);assert.equal(c.maxMessageSize,65536);handle.close();assert.equal(e.pcs[0].closed,true);await turn();assert.equal(e.timers.size,0);
});
test('guest retries hello, accepts targeted offer only, and does not revive after pending SDP on close',async()=>{
 const e=env();let opts;const sent=[];const g=e.ctx.AgelSharePeer.guest({...e.opts,expiresAt:Date.now()+100000,signalOpen:async o=>{opts=o;return{send:async m=>sent.push(m),close(){}};}});await until(()=>sent.length);const hello=sent[0];assert.equal(hello.type,'hello');e.tick(1000);await turn();assert.equal(sent.length,2);opts.onMessage({type:'offer',from:'33333333-3333-4333-8333-333333333333',to:'wrong',sdp:'offer'});await turn();assert.equal(e.pcs.length,0);
 let finishSDP;e.ctx.RTCPeerConnection.prototype.setRemoteDescription=function(d){return new Promise(r=>{finishSDP=()=>{this.remoteDescription=d;r();};});};opts.onMessage({type:'offer',from:'33333333-3333-4333-8333-333333333333',to:hello.from,sdp:'offer'});await until(()=>finishSDP);g.close();finishSDP();await assert.rejects(g.ready);await turn();assert.equal(e.pcs[0].closed,true);assert.equal(sent.filter(m=>m.type==='answer').length,0);await turn();assert.equal(e.timers.size,0);
});
test('peer expiry and connection timeout reject ready and release resources',async()=>{
 const e=env();let closed=0;const h=e.ctx.AgelSharePeer.host({...e.opts,expiresAt:Date.now()+999999999,signalOpen:async()=>({send:async()=>{},close:()=>closed++})});await turn();assert.ok([...e.timers.values()].some(t=>t.ms<=1800000));e.tick(1800000);await assert.rejects(h.ready);assert.equal(closed,1);assert.equal(e.timers.size,0);
 const b=env();const g=b.ctx.AgelSharePeer.guest({...b.opts,expiresAt:Date.now()+100000,signalOpen:signalBus()});await turn();b.tick(30000);await assert.rejects(g.ready,/red|conex|network/i);assert.equal(b.timers.size,0);
});
test('closing cancels an in-progress private join immediately',async()=>{
 const e=env();const opening=e.ctx.AgelShareSignal.open(e.opts);await until(()=>e.sockets.length);opening.close();await assert.rejects(opening);assert.equal(e.sockets[0].readyState,3);assert.equal(e.timers.size,0);assert.equal(e.cloud.listeners.size,0);
});
test('closing after negotiation delivers encrypted close before releasing signaling',async()=>{
 const e=env();let options,finishClose,signalClosed=false;const sent=[];const h=e.ctx.AgelSharePeer.host({...e.opts,expiresAt:Date.now()+100000,signalOpen:async o=>{options=o;return{send:async m=>{sent.push(m);if(m.type==='close')await new Promise(r=>finishClose=r);},close(){signalClosed=true;}};}});await turn();options.onMessage({type:'hello',from:'33333333-3333-4333-8333-333333333333'});await until(()=>sent.some(m=>m.type==='offer'));h.close();await assert.rejects(h.ready);assert.ok(finishClose);assert.equal(signalClosed,false);finishClose();await turn();assert.equal(signalClosed,true);assert.equal(e.timers.size,0);
});
test('initial ICE candidates wait until SDP is sent so the guest can select its host',async()=>{
 const e=env();let options;const sent=[];e.ctx.RTCPeerConnection.prototype.setLocalDescription=async function(d){this.localDescription=d;this.onicecandidate({candidate:{candidate:'candidate:one'}});};const h=e.ctx.AgelSharePeer.host({...e.opts,expiresAt:Date.now()+100000,signalOpen:async o=>{options=o;return{send:async m=>sent.push(m),close(){}};}});await turn();options.onMessage({type:'hello',from:'33333333-3333-4333-8333-333333333333'});await until(()=>sent.length>=2);assert.deepEqual(sent.map(m=>m.type),['offer','ice']);h.close();
});
function videoTrack(kind='video'){return{kind,stops:0,stop(){this.stops++;}};}
function installStreams(e){e.ctx.MediaStream=class{constructor(tracks=[]){this.tracks=[...tracks];}getTracks(){return[...this.tracks];}removeTrack(track){this.tracks=this.tracks.filter(t=>t!==track);}};return e.ctx.MediaStream;}
async function guestVideo(e,onTrack){let options;const sent=[];const peer=e.ctx.AgelSharePeer.guest({...e.opts,expiresAt:Date.now()+100000,onTrack,signalOpen:async o=>{options=o;return{send:async m=>sent.push(m),close(){}};}});await until(()=>sent.length);options.onMessage({type:'offer',from:'33333333-3333-4333-8333-333333333333',to:sent[0].from,sdp:'offer'});await until(()=>sent.some(m=>m.type==='answer'));return{peer,pc:e.pcs[0]};}
test('host adds supplied canvas video before offering, never adds audio, and releases video on close',async()=>{
 const e=env(),Stream=installStreams(e),video=videoTrack(),audio=videoTrack('audio'),stream=new Stream([video,audio]);let options;const order=[];
 e.ctx.RTCPeerConnection.prototype.addTrack=function(track,source){order.push('track');assert.equal(track,video);assert.equal(source,stream);};
 e.ctx.RTCPeerConnection.prototype.createOffer=async function(){order.push('offer');return{type:'offer',sdp:'offer'};};
 const peer=e.ctx.AgelSharePeer.host({...e.opts,stream,expiresAt:Date.now()+100000,signalOpen:async o=>{options=o;return{send:async()=>{},close(){}};}});await turn();options.onMessage({type:'hello',from:'33333333-3333-4333-8333-333333333333'});await until(()=>order.includes('offer'));assert.deepEqual(order,['track','offer']);peer.close();await assert.rejects(peer.ready);assert.equal(video.stops,1);assert.equal(audio.stops,0);peer.close();assert.equal(video.stops,1);
});
test('host close during signaling also releases the supplied video track',async()=>{
 const e=env(),Stream=installStreams(e),track=videoTrack();let resolve;const peer=e.ctx.AgelSharePeer.host({...e.opts,stream:new Stream([track]),expiresAt:Date.now()+100000,signalOpen:()=>new Promise(r=>resolve=r)});peer.close();await assert.rejects(peer.ready);assert.equal(track.stops,1);resolve({send:async()=>{},close(){}});await turn();assert.equal(e.pcs.length,0);
});
test('guest forwards one actual video stream, drops audio/extra tracks, and closes remote tracks',async()=>{
 const e=env(),Stream=installStreams(e),streams=[],video=videoTrack(),audio=videoTrack('audio'),extra=videoTrack();const remote=new Stream([video,audio]);const{peer,pc}=await guestVideo(e,s=>streams.push(s));assert.equal(typeof pc.ontrack,'function');const trackHandler=pc.ontrack;
 pc.ontrack({track:video,streams:[remote]});assert.equal(streams.length,1);assert.equal(streams[0],remote);assert.deepEqual(remote.getTracks(),[video]);assert.equal(audio.stops,1);
 pc.ontrack({track:video,streams:[remote]});assert.equal(video.stops,0);pc.ontrack({track:extra,streams:[new Stream([extra])]});assert.equal(extra.stops,1);assert.equal(streams.length,1);
 peer.close();await assert.rejects(peer.ready);assert.equal(pc.ontrack,null);assert.equal(video.stops,1);const late=videoTrack();trackHandler({track:late,streams:[new Stream([late])]});assert.equal(late.stops,1);assert.equal(streams.length,1);
});
test('guest wraps streamless video and drops streamless audio without calling onTrack',async()=>{
 const e=env(),Stream=installStreams(e),streams=[];const{peer,pc}=await guestVideo(e,s=>streams.push(s));const audio=videoTrack('audio');pc.ontrack({track:audio,streams:[]});assert.equal(audio.stops,1);assert.equal(streams.length,0);const video=videoTrack();pc.ontrack({track:video,streams:[]});assert.ok(streams[0] instanceof Stream);assert.deepEqual(streams[0].getTracks(),[video]);peer.close();await assert.rejects(peer.ready);assert.equal(video.stops,1);
});

test('presentation guest joins with public config only and keeps invitation key and SDP encrypted',async()=>{
 const e=env(),publicCloud={url:e.cloud.url,anonKey:e.cloud.anonKey};
 const {api,ws,join}=await signal(e,{cloud:publicCloud,presentation:true,guest:true});
 assert.equal(join.payload.config.private,false);assert.equal(join.payload.access_token,'public-anon');assert.match(join.topic,/^realtime:agel-view:[\w-]+:[\w-]+:[\w-]{43}$/);assert.ok(!JSON.stringify(join).includes(key));assert.ok(!ws.url.includes(key));
 await api.send({sdp:'PRIVATE_PIXELS_SIGNAL'});assert.ok(!JSON.stringify(ws.sent.at(-1)).includes('PRIVATE_PIXELS_SIGNAL'));api.close();assert.equal(e.events.get('storage')?.size||0,0);assert.equal(e.cloud.listeners.size,0);
});
test('presentation host stays authenticated and shares the same derived topic with an anonymous guest',async()=>{
 const a=env(),b=env(),received=[];
 const host=await signal(a,{presentation:true});const guest=await signal(b,{presentation:true,guest:true,cloud:{url:b.cloud.url,anonKey:b.cloud.anonKey},onMessage:m=>received.push(m)});
 assert.equal(host.join.topic,guest.join.topic);assert.equal(host.join.payload.access_token,'jwt1');await host.api.send({type:'hello',from:'source'});guest.ws.receive(host.ws.sent.at(-1));await until(()=>received.length===1);assert.equal(received[0].from,'source');guest.ws.receive(host.ws.sent.at(-1));await host.api.send({type:'hello',from:'sentinel'});guest.ws.receive(host.ws.sent.at(-1));await until(()=>received.length===2);assert.deepEqual(received.map(m=>m.from),['source','sentinel']);a.cloud.change(null);assert.equal(host.ws.readyState,3);guest.api.close();
 await assert.rejects(a.ctx.AgelShareSignal.open({...a.opts,presentation:true}));await assert.rejects(a.ctx.AgelShareSignal.open({...a.opts,guest:true}));
});
test('a wrong presentation key cannot authenticate even if a signal is relabeled with the guest topic',async()=>{
 const a=env(),b=env(),received=[];const host=await signal(a,{presentation:true});const guest=await signal(b,{presentation:true,guest:true,key:Buffer.alloc(32,8).toString('base64url'),cloud:{url:b.cloud.url,anonKey:b.cloud.anonKey},onMessage:m=>received.push(m)});
 assert.notEqual(host.join.topic,guest.join.topic);await host.api.send({from:'wrong-key'});guest.ws.receive({...host.ws.sent.at(-1),topic:guest.join.topic});await guest.api.send({from:'sentinel'});guest.ws.receive(guest.ws.sent.at(-1));await until(()=>received.length===1);assert.equal(received[0].from,'sentinel');host.api.close();guest.api.close();
});
test('peer passes presentation mode while fixing guest identity from its role',async()=>{
 for(const role of ['host','guest']){const e=env();let captured;const peer=e.ctx.AgelSharePeer[role]({...e.opts,presentation:true,expiresAt:Date.now()+60000,signalOpen:async opts=>{captured=opts;return{send:async()=>{},close(){}};}});await turn();assert.equal(captured.presentation,true);assert.equal(captured.guest,role==='guest');peer.close();}
});
