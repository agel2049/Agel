const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

const project='10000000-0000-4000-8000-000000000001',session='10000000-0000-4000-8000-000000000002';
function fixture(){
 const events=new EventTarget(),worker=new EventTarget(),nodes=new Map();
 for(const id of ['share-gate','share-status','share-login','share-banner','share-leave','sr-app'])nodes.set(id,{hidden:false,addEventListener(){},replaceChildren(){}});
 const location=new URL(`https://example.test/apps/share/#project=${project}&session=${session}&key=${'k'.repeat(43)}&expires=${Date.now()+60000}`);
 const cloud={user:{id:'owner'},storageKey:'agel.session',onAuth:()=>()=>{}};
 const root={addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),isSecureContext:true,RTCPeerConnection:class{}};
 worker.register=async()=>{};worker.ready=Promise.resolve();worker.controller={scriptURL:'https://example.test/apps/share/media-worker.js',postMessage(){}};
 const context={window:root,document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[]},navigator:{serviceWorker:worker},location,URL,URLSearchParams,AgelCloud:{client:()=>cloud},AgelSharePeer:{guest:()=>({ready:Promise.resolve(),close(){}})},setTimeout:()=>1,clearTimeout(){},history:{replaceState(){}}};
 vm.runInNewContext(fs.readFileSync('apps/share/receiver.js','utf8'),context);
 let closed=0;root.AgelTemporarySession.onClose(()=>closed++);
 return {location,cloud,nodes,get closed(){return closed;},hash(hash){location.hash=hash;events.dispatchEvent(new Event('hashchange'));},storage(value,key='agel.session'){const e=new Event('storage');Object.assign(e,{key,oldValue:JSON.stringify({user:{id:'owner'},access_token:'old'}),newValue:value});events.dispatchEvent(e);}};
}
test('ordinary showroom anchors keep the temporary session open',()=>{
 const f=fixture();for(const hash of ['#contacto','#modelo','#'])f.hash(hash);
 assert.equal(f.closed,0);
});
test('the original credentials remain recognized after anchor navigation',()=>{
 const f=fixture(),link=f.location.hash;f.hash('#contacto');f.hash(link);
 assert.equal(f.closed,0);
});
test('replacing QR credentials closes the previous temporary session',()=>{
 for(const field of ['project','session','key','expires']){
  const f=fixture(),p=new URLSearchParams(f.location.hash.slice(1));
  p.set(field,field==='key'?'n'.repeat(43):field==='expires'?String(Date.now()+120000):'10000000-0000-4000-8000-000000000099');
  f.hash('#'+p);assert.equal(f.closed,1,field);
 }
});
test('a same-account token refresh keeps the temporary session open',()=>{
 const f=fixture();f.storage(JSON.stringify({user:{id:'owner'},access_token:'refreshed'}));assert.equal(f.closed,0);
});
test('logout, account replacement, cleared storage and invalid session close the temporary session',()=>{
 for(const [value,key] of [[null,'agel.session'],[JSON.stringify({user:{id:'other'}}),'agel.session'],[null,null],['invalid','agel.session']]){
  const f=fixture();f.storage(value,key);assert.equal(f.closed,1);
 }
});
