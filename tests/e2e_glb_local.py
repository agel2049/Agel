import os
from pathlib import Path
from urllib.parse import urlparse
from ui_harness import local_page
from glb_fixture import glb_bytes
vendor=Path(os.environ.get('AGEL_THREE_VENDOR',str(Path(__file__).parent/'vendor/node_modules/three')))
def setup(pg):
 pg.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**',lambda r:r.fulfill(path=str(vendor/urlparse(r.request.url).path.split('three@0.128.0/')[1])))
with local_page('tests/fixtures/glb-viewer.html',setup=setup) as pg:
 assert pg.evaluate('typeof AgelGLB')=='object','Local GLB renderer unavailable'
 requests=[];pg.on('request',lambda r:requests.append(r.url))
 rows=pg.evaluate('''async bytes=>{window.viewer=await AgelGLB.open(document.getElementById('viewer'),{blob:new Blob([new Uint8Array(bytes)],{type:'model/gltf-binary'})});return viewer.elements.map(e=>({name:e.name,discipline:e.discipline,material:e.material,level:e.level}));}''',list(glb_bytes()))
 assert len(rows)==3,rows
 assert {r['material'] for r in rows}=={'Ladrillo','Cobre','Pintura'},rows
 canvas=pg.locator('canvas');canvas.wait_for();pg.wait_for_timeout(100)
 before=canvas.screenshot()
 assert pg.evaluate("viewer.filter({preset:'mep'}).map(e=>e.name)")==['Tubería_01']
 pg.wait_for_timeout(100);assert before!=canvas.screenshot(),'Filter did not change rendered geometry'
 assert pg.evaluate("viewer.filter({facets:{level:['missing']}}).length")==0
 assert pg.evaluate('viewer.filter({}).length')==3
 pg.evaluate('viewer.dispose()');assert pg.locator('canvas').count()==0
 assert not any('forbidden.example' in u for u in requests)
 assert pg.evaluate('''async bytes=>{try{await AgelGLB.open(document.getElementById('viewer'),{blob:new Blob([new Uint8Array(bytes)])});return false;}catch(e){return /externos|autocontenido/i.test(e.message);}}''',list(glb_bytes(external=True)))
 assert not any('forbidden.example' in u for u in requests)
 assert pg.locator('canvas').count()==0
 print('PASS: real GLB parts/rendering, MEP visibility, empty filter, external resource rejection and cleanup')
 pg.evaluate('''async bytes=>{window.viewer=await AgelGLB.open(document.getElementById('viewer'),{blob:new Blob([new Uint8Array(bytes)])});viewer.filter({preset:'mep'});}''',list(glb_bytes(nested=True)))
 pixels=pg.evaluate('''async()=>{viewer.filter({preset:'mep'});return new Promise(resolve=>requestAnimationFrame(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2')||c.getContext('webgl'),p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);let count=0;for(let i=0;i<p.length;i+=4)if(Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])>35)count++;resolve(count);}));}''')
 assert pixels>100,'Hiding a parent mesh also hid its selected child'
 pg.evaluate('viewer.dispose()')
 print('PASS: nested child remains rendered while its parent geometry is filtered out')
