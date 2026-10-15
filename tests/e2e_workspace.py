from ui_harness import local_page
with local_page('tests/fixtures/workspace.html') as pg:
 assert pg.evaluate('typeof AgelWorkspace')=='object','Missing local-first workspace'
 result=pg.evaluate('''async()=>{
  const w=await AgelWorkspace.open({cloud,ownerId:owner,projectId:'project-a'});
  const media=await w.addMedia(new File(['data'],'local.txt',{type:'text/plain'}),'doc');
  const d=await w.load();d.showroom.description='Borrador local';await w.save(d);
  await w.updateSpace({id:'a',name:'Depto actualizado'});
  return {ref:media.ref.startsWith('agel-local:'),writes:writes.length,revision:w.baseRevision,dirty:w.dirty};
 }''')
 assert result=={'ref':True,'writes':0,'revision':7,'dirty':True},result
 pg.reload()
 result=pg.evaluate('''async()=>{
 const w=await AgelWorkspace.open({cloud,ownerId:owner,projectId:'project-a'}),d=await w.load();
 return {description:d.showroom.description,name:d.spaces[0].name,media:d.media.length};
 }''')
 assert result=={'description':'Borrador local','name':'Depto actualizado','media':1},result
 assert pg.evaluate('''async()=>{
 const w=await AgelWorkspace.open({cloud,ownerId:owner,projectId:'project-a'}),d=await w.load(),copy=structuredClone(d);
 d.showroom.description='Primera pestaña';await w.save(d);
 try{copy.showroom.description='Segunda';await w.save(copy);return false;}catch(e){return /otra pestaña/.test(e.message);}
 }''')
 assert pg.evaluate("""async()=>{const w=await AgelWorkspace.open({cloud,ownerId:owner,projectId:'project-a'}),d=await w.load();d.showroom.gallery=[{url:d.media[0].ref}];await w.save(d);const m=await w.previewManifest();return m.content.gallery[0].url.startsWith('blob:')&&!JSON.stringify(m).includes('privateSettings');}""")
 assert pg.evaluate('''async()=>{const w=await AgelWorkspace.open({cloud,ownerId:owner,projectId:'project-a'});owner='owner-b';try{await w.load();return false;}catch(e){return /cuenta/.test(e.message);}}''')
 print('PASS: local-first authoring, reload, no cloud writes, stale tab conflict and account change')
with local_page('tests/fixtures/panel-local.html') as pg:
 pg.get_by_role('button',name='Agregar imágenes',exact=True).wait_for()
 pg.get_by_role('button',name='Agregar imágenes',exact=True).locator('..').locator('input[type=file]').set_input_files({'name':'foto.png','mimeType':'image/png','buffer':__import__('base64').b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e8AAAAASUVORK5CYII=')})
 pg.get_by_text('Guardado en este dispositivo.',exact=False).wait_for()
 assert pg.evaluate('writes')==[]
 pg.reload();pg.locator('.pn-media img').first.wait_for()
 assert pg.locator('.pn-media img').first.get_attribute('src').startswith('blob:')
 print('PASS: panel file input persists locally with no cloud upload/update')
