from ui_harness import local_page
from ifc_fixture import ifc_bytes
with local_page('tests/fixtures/ifc-import.html') as pg:
 for mode in ['separate','mixed']:
  result=pg.evaluate('''async bytes=>{const w=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'ifc-project'});return (await AgelIFC.importFile({workspace:w,file:new File([new Uint8Array(bytes)],'mixed.ifc')})).summary;}''',list(ifc_bytes(surfaces=mode)))
  assert result['elements']==4,result
  assert result['skippedParts']==(1 if mode=='separate' else 4),result
  assert result['skippedElements']==(1 if mode=='separate' else 0),result
  assert len(result['issues'])==(1 if mode=='separate' else 4),result
  assert result['geometries']==1,result
 result=pg.evaluate('''async bytes=>{const w=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'ifc-project'}),d=await w.load();d.showroom.model3d={url:'https://example.test/previous.glb'};await w.save(d);const count=(await w.store.list()).length;try{await AgelIFC.importFile({workspace:w,file:new File([new Uint8Array(bytes)],'empty.ifc')});return {accepted:true};}catch(e){return {error:e.message,unchanged:(await w.load()).showroom.model3d.url==='https://example.test/previous.glb',sameMedia:(await w.store.list()).length===count};}}''',list(ifc_bytes(surfaces='all-empty')))
 assert 'no contiene piezas' in result['error'],result
 assert result['unchanged'] and result['sameMedia'],result
 print('PASS: real IFC empty surfaces do not block good objects; partial objects reported; fully empty IFC preserves previous model')
