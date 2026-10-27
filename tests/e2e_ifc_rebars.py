"""Real WASM regression: full Revit indexed sweeps, straight and bent rebars."""
from pathlib import Path
from urllib.parse import urlparse
from ui_harness import local_page
from ifc_fixture import rebar_bytes
vendor=Path(__file__).parent/'vendor/node_modules/three'
def setup(pg):
 pg.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**',lambda r:r.fulfill(path=str(vendor/urlparse(r.request.url).path.split('three@0.128.0/')[1])))
with local_page('tests/fixtures/ifc-import.html',setup=setup) as pg:
 for partial in [False,True]:
  result=pg.evaluate('''async bytes=>{
   const w=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'ifc-project'}),r=await AgelIFC.importFile({workspace:w,file:new File([new Uint8Array(bytes)],'rebars.ifc')}),blob=(await w.store.get(r.ref)).blob;
   const view=await AgelGLB.open(document.querySelector('#viewer'),{blob}),bars=view.filter({preset:'rebar'}),answer={elements:r.summary.elements,bars:bars.length,adapted:r.summary.adaptedIndexedSweeps,unsupported:r.summary.unsupportedIndexedSweeps};view.dispose();return answer;
  }''',list(rebar_bytes(partial)))
  assert result==({'elements':4,'bars':0,'adapted':0,'unsupported':2} if partial else {'elements':6,'bars':2,'adapted':2,'unsupported':0}),result
 print('PASS: straight/bent indexed-sweep rebars render and filter; partial trims are preserved and reported')
