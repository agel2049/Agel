from ui_harness import local_page
with local_page('tests/fixtures/workspace.html') as pg:
 result=pg.evaluate('''async()=>{
  const ws=await AgelWorkspace.open({cloud,ownerId:owner,projectId:'project-a'});
  const m=await ws.addMedia(new File(['glb fixture bytes'],'edificio.glb',{type:'model/gltf-binary'}),'glb');
  const d=await ws.load();d.showroom.model3d={url:m.ref,title:'Edificio local'};await ws.save(d);
  const preview=await ws.previewManifest(),model=preview.content.model3d;
  return {title:model?.title,local:model?.url.startsWith('blob:'),bytes:model?(await(await fetch(model.url)).blob()).size:0,writes};
 }''')
 assert result=={'title':'Edificio local','local':True,'bytes':17,'writes':[]},result
 print('PASS: local GLB survives validation and resolves to the original Blob without upload')
