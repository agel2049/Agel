import os
from pathlib import Path
from urllib.parse import urlparse
from ui_harness import local_page
from glb_fixture import glb_bytes
vendor=Path(os.environ.get('AGEL_THREE_VENDOR',str(Path(__file__).parent/'vendor/node_modules/three')))
def setup(pg):
 pg.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**',lambda r:r.fulfill(path=str(vendor/urlparse(r.request.url).path.split('three@0.128.0/')[1])))
with local_page('tests/fixtures/remote-model.html',setup=setup) as pg:
 pg.evaluate('mountRemote',list(glb_bytes()))
 pg.wait_for_function("remoteStates.some(m=>m.state==='ready')")
 pg.wait_for_function("document.querySelector('video').readyState>=2")
 assert pg.evaluate('drawnFrames')>0,'Renderer did not composite a WebGL frame'
 assert pg.evaluate('typeof renderedViewer.orbit')=='function','Renderer remote orbit is unavailable'
 assert pg.evaluate("document.querySelector('video').videoWidth")==720
 pg.wait_for_timeout(200)
 watermark=pg.evaluate('''()=>{const c=document.createElement('canvas');c.width=720;c.height=480;const x=c.getContext('2d');x.drawImage(document.querySelector('video'),0,0,720,480);const p=x.getImageData(20,440,320,28).data;let light=0;for(let i=0;i<p.length;i+=4)if(p[i]>170&&p[i+1]>170&&p[i+2]>170)light++;return light;}''')
 assert watermark>200,'Session watermark text is missing from transmitted video pixels'
 video=pg.locator('video');before=pg.evaluate('videoPixels()')
 pg.get_by_label('Vista de maqueta',exact=True).select_option('top');pg.wait_for_timeout(200)
 assert before!=pg.evaluate('videoPixels()'),'Rendered camera view was not transmitted to video'
 before=pg.evaluate('videoPixels()');box=video.bounding_box();pg.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.45);pg.mouse.down();pg.mouse.move(box['x']+box['width']*.7,box['y']+box['height']*.6,steps=4);pg.mouse.up();pg.wait_for_timeout(200)
 assert before!=pg.evaluate('videoPixels()'),'Remote orbit did not change rendered video'
 video.focus();pg.keyboard.press('w');assert pg.evaluate("remoteCommands.at(-1).action")=='pan'
 pg.get_by_role('button',name='Instalaciones (1)',exact=True).click();pg.wait_for_timeout(200)
 assert pg.get_by_role('status').inner_text()=='1 de 3 piezas'
 assert not any(k in pg.evaluate('JSON.stringify(remoteStates)') for k in ['Tubería_01','geometry','secretid'])
 assert pg.get_by_role('button',name='Ver en mi espacio').count()==0
 pg.get_by_role('button',name='Cerrar maqueta',exact=True).click();assert pg.locator('video').count()==0
 assert pg.evaluate("remoteCommands.at(-1).action")=='pause';assert pg.evaluate("remoteHost.stream.getTracks().every(t=>t.readyState==='live')")
 pg.evaluate('remoteHost.close()');assert pg.locator('#source canvas').count()==0;assert pg.evaluate("remoteHost.stream.getTracks().every(t=>t.readyState==='ended')")
 print('PASS: real WebGL pixels transmitted by canvas stream, views/orbit/pan/filter, no geometry metadata, pause and track/GPU cleanup')
