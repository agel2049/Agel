const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const schema=require('../packages/core/schema.js');
const relations=require('../packages/showroom/relations.js');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const blobs=new Map([['agel-local:video',new Blob(['movie'],{type:'video/webm'})],['agel-local:model',new Blob(['glb'],{type:'model/gltf-binary'})],['agel-local:photo',new Blob(['image'],{type:'image/jpeg'})],['agel-local:disguised',new Blob([new Uint8Array([0x67,0x6c,0x54,0x46,2,0,0,0])],{type:'image/jpeg'})],['agel-local:secret',new Blob(['private'])]]);
 const draft={tree:{project:{id:id(1),name:'Edificio',kind:'edificio',owner_id:'PRIVATE_OWNER',access_token:'PRIVATE_TOKEN'},role:'owner',scenes:[{id:id(3),name:'Lobby',pano_url:'agel-local:photo',hs:[]}]},spaces:[{id:id(2),name:'Piso',kind:'nivel',scene_ids:[id(3)],private_notes:'PRIVATE_NOTES'}],showroom:{gallery:[{url:'agel-local:model'},{url:'https://example.test/technical.glb'}],privateSettings:{secret:'PRIVATE_NESTED'},model3d:{url:'agel-local:model'},opening:{enabled:true,video:'agel-local:video'},experience:{version:1,facadeViewId:'f',entryTargetViewId:'l'},views:[{id:'f',image:'agel-local:photo',role:'facade',regions:[],spots:[]},{id:'l',image:'agel-local:photo',role:'lobby',spaceId:id(2),regions:[],spots:[{scene:id(3),x:20,y:30}]}]},media:[{ref:'agel-local:video',mime:'video/webm',kind:'video',name:'movie.webm'},{ref:'agel-local:model',mime:'model/gltf-binary',kind:'glb',name:'building.glb'},{ref:'agel-local:photo',mime:'image/jpeg',kind:'image',name:'photo.jpg'},{ref:'agel-local:disguised',mime:'image/jpeg',kind:'image',name:'photo.jpg'},{ref:'agel-local:secret',kind:'image'}],privateSettings:{apsToken:'PRIVATE_APS'},localRevision:1};
 const reads=[],cloud={user:{id:'owner'}},store={loadDraft:async()=>structuredClone(draft),get:async ref=>{reads.push(ref);return {blob:blobs.get(ref)};},url:async()=> 'blob:local'};
 const context={window:{},AgelLocalMedia:{open:async()=>store},sanitizeShowroom:schema.sanitizeShowroom,AgelShowroomRelations:relations,crypto:webcrypto,URL,structuredClone,Blob,AbortController,TextDecoder,fetch:()=>{throw Error('unexpected network');}};
 vm.runInNewContext(fs.readFileSync('packages/core/workspace.js','utf8'),context);
 const ws=await context.window.AgelWorkspace.open({cloud,ownerId:'owner',projectId:id(1)});return {ws,reads,cloud,draft,store,context};
}
test('temporary package preserves experience, scene links, Opening without private fields or original GLB',async()=>{
 const {ws,reads}=await fixture();assert.equal(typeof ws.sharePackage,'function');
 const {snapshot,assets,remoteModel}=await ws.sharePackage();
 assert.equal(reads.length,0,'files remain lazy');
 assert.equal(JSON.stringify(snapshot).includes('PRIVATE'),false);
 assert.equal(snapshot.privateSettings,undefined);assert.equal(snapshot.project.owner_id,undefined);
 assert.equal(assets.size,2,'model originals and unreferenced secrets are not exposed');assert.equal(remoteModel.available,true);assert.equal(snapshot.showroom.model3d,null);
 const m=schema.sanitizeShowroom(snapshot);assert.equal(m.scenes.length,1);assert.equal(m.content.views[1].spots[0].scene,0);assert.equal(m.spaces[0].scenes[0],0);
 assert.equal(m.opening.enabled,true);assert.match(m.opening.video,/^https:\/\/agel-share.invalid\/[0-9a-f-]+\.webm$/);
 assert.equal(m.content.model3d,null);assert.equal(m.content.experience.facadeViewId,'f');
 for(const [key,value] of assets){assert.match(key,/^[0-9a-f-]{36}$/);assert.ok((await value.getBlob()) instanceof Blob);}
 ws.close();await assert.rejects(assets.values().next().value.getBlob(),/cuenta|cerr|proyecto/i);
});
test('account change prevents package reads',async()=>{const {ws,cloud}=await fixture();const p=await ws.sharePackage();cloud.user.id='other';await assert.rejects(p.assets.values().next().value.getBlob(),/cuenta/);});

test('disguised GLB magic cannot leave through an image asset',async()=>{const {ws,draft}=await fixture();draft.showroom.gallery=[{url:'agel-local:disguised'}];const p=await ws.sharePackage();const url=p.snapshot.showroom.gallery[0].url,id=url.split('/').pop().split('.')[0];await assert.rejects(p.assets.get(id).getBlob(),/modelo|maqueta|GLB/i);});
test('closing a package aborts pending source fetch and prevents late reads',async()=>{
 const {ws,draft,context}=await fixture();draft.showroom.gallery=[{url:'https://example.test/photo.jpg'}];let requestSignal;
 context.fetch=(url,{signal})=>new Promise((resolve,reject)=>{requestSignal=signal;signal.addEventListener('abort',()=>reject(Error('source fetch aborted')),{once:true});});
 const p=await ws.sharePackage();assert.equal(typeof p.close,'function');const id=p.snapshot.showroom.gallery[0].url.split('/').pop().split('.')[0];const reading=p.assets.get(id).getBlob();p.close();assert.equal(requestSignal.aborted,true);await assert.rejects(reading,/aborted/);await assert.rejects(p.assets.get(id).getBlob(),/cerr|finaliz/i);
});

test('IFC originals are excluded even when linked as gallery media',async()=>{
 const {ws,draft}=await fixture();draft.media.push({ref:'agel-local:ifc',kind:'ifc',mime:'application/x-step',name:'source.ifc'});draft.showroom.gallery=[{url:'agel-local:ifc'},{url:'https://example.test/model.ifc'}];
 const pkg=await ws.sharePackage();assert.equal(pkg.assets.size,2);assert.ok(!JSON.stringify(pkg.snapshot).includes('source.ifc'));assert.ok(!JSON.stringify(pkg.snapshot).includes('model.ifc'));
});

test('a disguised IFC cannot leave through a JPEG resource',async()=>{
 const {ws,draft,store}=await fixture();draft.showroom.gallery=[{url:'agel-local:disguised'}];const get=store.get;store.get=async ref=>ref==='agel-local:disguised'?{blob:new Blob([' '.repeat(300)+'ISO-10303-21; HEADER;'],{type:'image/jpeg'})}:get(ref);
 const pkg=await ws.sharePackage();await assert.rejects(pkg.assets.get(pkg.snapshot.showroom.gallery[0].url.split('/').pop().split('.')[0]).getBlob(),/IFC original/);
});

for(const padding of [0,300,4090,8192])test('fetched IFC behind '+padding+' whitespace bytes is never returned as an image',async()=>{
 const {ws,draft,context}=await fixture();draft.showroom.gallery=[{url:'https://example.test/photograph.jpg'}];context.fetch=async()=>({ok:true,headers:{get:()=> 'image/jpeg'},blob:async()=>new Blob([' '.repeat(padding)+'ISO-10303-21; HEADER;'],{type:'image/jpeg'})});const pkg=await ws.sharePackage(),id=pkg.snapshot.showroom.gallery[0].url.split('/').pop().split('.')[0];await assert.rejects(pkg.assets.get(id).getBlob(),/IFC original/);
});
