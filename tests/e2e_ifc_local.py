from pathlib import Path
from urllib.parse import urlparse
from ui_harness import local_page
from ifc_fixture import ifc_bytes
vendor=Path(__file__).parent/'vendor/node_modules/three'
def setup(pg):
 pg.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**',lambda r:r.fulfill(path=str(vendor/urlparse(r.request.url).path.split('three@0.128.0/')[1])))
with local_page('tests/fixtures/ifc-import.html',setup=setup) as pg:
 assert pg.evaluate('typeof AgelIFC')=='object','Local IFC importer unavailable'
 requests=[];pg.on('request',lambda r:requests.append((r.method,r.url)))
 cases=[('IFC4',ifc_bytes()),('IFC2X3',ifc_bytes('IFC2X3')),('IFC4X3',ifc_bytes('IFC4X3')),('IFC4-mm',ifc_bytes(millimeters=True)),('IFC4-detailed',ifc_bytes(typed_material=True,offset=10000000,long_header=True))]
 for schema,data in cases:
  result=pg.evaluate('''async ({data,schema})=>{window.ws=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'ifc-project'});const d=await ws.load();const result=await AgelIFC.importFile({workspace:ws,file:new File([new Uint8Array(data)],schema+'.ifc'),expectedRevision:d.localRevision});window.imported=result;window.view=await AgelGLB.open(document.getElementById('viewer'),{blob:(await ws.store.get(result.ref)).blob});return {summary:result.summary,rows:view.elements};}''',{'data':list(data),'schema':schema})
  assert len(result['rows'])==4,result
  assert result['summary']['geometries']==1,result
  assert {r['level'] for r in result['rows']}=={'Nivel 1'},result
  for preset,name in [('masonry','Muro'),('structure','Viga'),('mep','Tuberia'),('finishes','Acabado')]:
   assert pg.evaluate('(p)=>view.filter({preset:p}).map(e=>e.name)',preset)==[name],(preset,result)
  assert pg.evaluate("view.elements.find(e=>e.name==='Muro').material")=='Ladrillo'
  extent=pg.evaluate('view.extent');assert 12<extent<16,extent
  height=pg.evaluate('''async()=>{const bytes=await(await ws.store.get(imported.ref)).blob.arrayBuffer(),g=await new Promise((res,rej)=>new THREE.GLTFLoader().parse(bytes,'',res,rej)),box=new THREE.Box3().setFromObject(g.scene),size=box.getSize(new THREE.Vector3());g.scene.traverse(n=>{n.geometry?.dispose();if(n.material)n.material.dispose();});return size.toArray();}''')
  assert abs(height[1]-3)<.01,('IFC vertical axis/scale',height)
  pg.evaluate('view.dispose()')
  cached=pg.evaluate('''async ({data,schema})=>{const d=await ws.load(),r=await AgelIFC.importFile({workspace:ws,file:new File([new Uint8Array(data)],schema+'.ifc'),expectedRevision:d.localRevision});return {cached:r.cached,ref:r.ref,original:imported.ref};}''',{'data':list(data),'schema':schema})
  assert cached['cached'] and cached['ref']==cached['original'],cached
 pg.reload();assert pg.evaluate('''async()=>{const w=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'ifc-project'}),d=await w.load();return d.ifcImports&&Object.keys(d.ifcImports).length===5;}''')
 sync=pg.evaluate('''async()=>{const w=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'ifc-project'}),d=await w.load();d.showroom.model3d={url:Object.values(d.ifcImports)[0].ref};await w.save(d);const p=await AgelSync.plan(d,w.store);await w.reloadCloud();return {kinds:p.assets.map(a=>a.kind),caches:Object.keys((await w.load()).ifcImports).length};}''')
 assert sync=={'kinds':['glb'],'caches':5},sync
 assert not any(method not in ['GET','HEAD'] or '/rest/v1/' in url for method,url in requests),requests
 print('PASS: real IFC2X3/IFC4/IFC4X3 WASM, millimetres, type material and large coordinates/header, four filter presets, storey/material, reused geometry, cache/reload without upload')
with local_page('tests/fixtures/ifc-import.html',setup=setup) as pg:
 data=list(ifc_bytes())
 result=pg.evaluate(r'''async bytes=>{
 const ws=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'ifc-project'});let d=await ws.load();d.showroom.model3d={url:'https://example.test/previous.glb'};await ws.save(d);const before=await ws.load(),media=(await ws.store.list()).length;
 const attempt=async(extra,options={})=>AgelIFC.importFile({workspace:ws,file:new File([new Uint8Array(bytes),'\n'+extra],'model.ifc'),expectedRevision:(await ws.load()).localRevision,...options});
 let cancelled=false;const controller=new AbortController();try{await attempt('cancel',{signal:controller.signal,onProgress:t=>{if(t.includes('Leyendo estructura'))controller.abort();}});}catch(e){cancelled=e.name==='AbortError';}
 const afterCancel=(await ws.load()).showroom.model3d.url;
 const put=ws.store.put;ws.store.put=async function(blob,options){if(options.kind==='glb')throw new DOMException('No space','QuotaExceededError');return put.call(this,blob,options);};let quota=false;try{await attempt('quota');}catch(e){quota=e.name==='QuotaExceededError';}finally{ws.store.put=put;}
 const afterQuota=(await ws.load()).showroom.model3d.url,remaining=(await ws.store.list()).length;
 let conflict=false,pending;try{await attempt('conflict',{onProgress:t=>{if(!pending&&t.includes('Leyendo estructura'))pending=(async()=>{const x=await ws.load();x.showroom.description='Otra pestaña';await ws.save(x);})();}});}catch(e){conflict=/otra pestaña/.test(e.message);}await pending;
 let invalid=false;try{await AgelIFC.importFile({workspace:ws,file:new File(['invalid'],'bad.ifc')});}catch(e){invalid=/IFC STEP/.test(e.message);}
 return {cancelled,quota,conflict,invalid,unchanged:afterCancel===before.showroom.model3d.url&&afterQuota===before.showroom.model3d.url&&remaining===media,description:(await ws.load()).showroom.description};
 }''',data)
 assert result=={'cancelled':True,'quota':True,'conflict':True,'invalid':True,'unchanged':True,'description':'Otra pestaña'},result
 print('PASS: cancellation terminates actual worker, quota rolls back new copies, stale draft and invalid input preserve model')
