from ui_harness import local_page
with local_page('tests/fixtures/local-media.html') as pg:
 assert pg.evaluate('typeof AgelLocalMedia')=='object','Missing persistent local media store'
 result=pg.evaluate('''async()=>{
   const store=await AgelLocalMedia.open({ownerId:'owner-a',projectId:'project-a'});
   const file=new File(['original local'], 'planta.txt',{type:'text/plain'});
   const m=await store.put(file,{id:'file-a',kind:'doc'});
   return {ref:m.ref,bytes:m.bytes,original:await (await store.get(m.ref)).blob.text()};
 }''')
 assert result=={'ref':'agel-local:file-a','bytes':14,'original':'original local'},result
 pg.reload()
 assert pg.evaluate('''async()=>{const s=await AgelLocalMedia.open({ownerId:'owner-a',projectId:'project-a'});return (await s.list()).length;}''')==1
 assert pg.evaluate('''async()=>{const s=await AgelLocalMedia.open({ownerId:'owner-b',projectId:'project-a'});return (await s.list()).length;}''')==0
 assert pg.evaluate('''async()=>{
   const s=await AgelLocalMedia.open({ownerId:'owner-a',projectId:'project-a'});
   const m=await s.put(new Blob([new Uint8Array(34*1024*1024)],{type:'application/octet-stream'}),{id:'large-local',kind:'doc'});
   return m.bytes;
 }''')==34*1024*1024
 result=pg.evaluate('''async()=>{
  const s=await AgelLocalMedia.open({ownerId:'owner-a',projectId:'project-a'});
  await s.saveDraft({title:'borrador',ref:'agel-local:file-a'});
  const bundle=await AgelLocalBackup.manifest(s);
  await s.markSynced('agel-local:file-a',{asset_id:'asset-a',url:'https://files.example/planta.txt'});
  return {count:bundle.files.length,draft:(await s.loadDraft()).title,synced:(await s.get('agel-local:file-a')).cloud.url};
 }''')
 assert result=={'count':2,'draft':'borrador','synced':'https://files.example/planta.txt'},result
 assert pg.evaluate('''async()=>{const s=await AgelLocalMedia.open({ownerId:'owner-a',projectId:'project-a'});try{await s.get('agel-local:missing');return false;}catch(e){return /no disponible/.test(e.message);}}''')
 result=pg.evaluate('''async()=>{
  const s=await AgelLocalMedia.open({ownerId:'owner-a',projectId:'project-a'});
  const bundle=await AgelLocalBackup.manifest(s);bundle.files=bundle.files.filter(f=>f.id==='file-a');
  await AgelLocalBackup.importProject(s,bundle,[new File(['otro contenido'],bundle.files[0].path,{type:'text/plain'})]);
  return {original:await (await s.get('agel-local:file-a')).blob.text(),restored:await (await s.get((await s.loadDraft()).ref)).blob.text()};
 }''')
 assert result=={'original':'original local','restored':'otro contenido'},result
 result=pg.evaluate('''async()=>{
  const s=await AgelLocalMedia.open({ownerId:'owner-a',projectId:'project-a'}),previous=IDBObjectStore.prototype.put;
  const before=JSON.stringify(await s.loadDraft());
  try {IDBObjectStore.prototype.put=function(value){if(this.name==='media')throw new DOMException('quota','QuotaExceededError');return previous.call(this,value);};
   await s.put(new Blob(['failed']),{id:'quota',kind:'doc'});return {failed:false};
  }catch(e){return {failed:/espacio/.test(e.message),preserved:JSON.stringify(await s.loadDraft())===before};}
  finally {IDBObjectStore.prototype.put=previous;}
 }''')
 assert result=={'failed':True,'preserved':True},result
 print('PASS: local persistence, accounts, 34 MiB, draft, backup and nondestructive restore')
