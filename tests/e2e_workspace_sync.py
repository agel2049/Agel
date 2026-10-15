from ui_harness import local_page
with local_page('tests/fixtures/workspace-sync.html') as pg:
 assert pg.evaluate('typeof AgelSync')=='object','Missing explicit synchronization'
 result=pg.evaluate('''async()=>{
 let transfers=0,saves=0,reserved=0;const user={id:'sync-owner'},cloud={user,
 select:async()=>[],publicUrl:(b,p)=>'https://cloud.example/'+b+'/'+p,
 rpc:async(name,args)=>{if(name==='load_workspace_settings')return {};if(name==='load_project_tree')return {revision:2,role:'owner',project:{id:'sync-project',showroom:{}},scenes:[]};
 if(name==='begin_sync_asset'){reserved++;return {asset_id:'asset',bucket:'media',path:'p/image',status:'uploading'};}
 if(name==='complete_sync_asset')return {asset_id:'asset',bucket:'media',path:'p/image',status:transfers?'ready':'uploading'};
 if(name==='save_workspace_snapshot'){saves++;if(saves===1)throw Error('Conflicto de revisión');return {revision:3};}},
 transferReserved:async()=>{transfers++;}};
 const ws=await AgelWorkspace.open({cloud,ownerId:user.id,projectId:'sync-project'}),m=await ws.addMedia(new File(['small'],'image.png',{type:'image/png'}),'image');
 let d=await ws.load();d.showroom.gallery=[{url:m.ref}];await ws.save(d);
 try{await AgelSync.run({workspace:ws,cloud});}catch(e){if(!/Conflicto/.test(e.message))throw e;}
 const preserved=(await ws.load()).showroom.gallery[0].url===m.ref;
 await AgelSync.run({workspace:ws,cloud});d=await ws.load();
 return {transfers,reserved,saves,preserved,dirty:ws.dirty,revision:ws.baseRevision,url:d.showroom.gallery[0].url,original:await (await ws.store.get(m.ref)).blob.text()};
 }''')
 assert result=={'transfers':1,'reserved':1,'saves':2,'preserved':True,'dirty':False,'revision':3,'url':'https://cloud.example/media/p/image','original':'small'},result
 print('PASS: explicit retry reuses completed upload, conflict retains draft and originals')

 assert pg.evaluate("""async()=>{
 const store=await AgelLocalMedia.open({ownerId:'quota',projectId:'p'}),m=await store.put(new File([new Uint8Array(17*1048576)],'large.png',{type:'image/png'}),{kind:'image'});
 const p=await AgelSync.plan({showroom:{image:m.ref}},store);return p.blocked.length===1&&p.assets.length===1;
 }""")
 print('PASS: local original above cloud limit is blocked before transmission')
