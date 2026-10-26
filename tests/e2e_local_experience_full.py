import os,tempfile,re
from pathlib import Path
from urllib.parse import urlparse
from ui_harness import local_page
from glb_fixture import glb_bytes
fixtures=Path(__file__).parent/'fixtures'
vendor=Path(os.environ.get('AGEL_THREE_VENDOR',str(Path(__file__).parent/'vendor/node_modules/three')))
project='10000000-0000-4000-8000-000000000001'
def setup(pg):
 ctx=pg.context
 ctx.route('**/packages/core/cloud.js',lambda r:r.fulfill(path=str(fixtures/'local-experience-cloud.js'),content_type='text/javascript'))
 ctx.route('https://fixture.agelarq.test/**',lambda r:r.fulfill(path=str(fixtures/'pano_a.jpg'),content_type='image/jpeg'))
 ctx.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**',lambda r:r.fulfill(path=str(vendor/urlparse(r.request.url).path.split('three@0.128.0/')[1])))
with tempfile.TemporaryDirectory() as tmp,local_page(f'apps/panel/#/p/{project}/showroom',setup=setup) as pg:
 pg.get_by_role('button',name=re.compile('GLB')).locator('..').locator('input[type=file]').set_input_files({'name':'edificio.glb','mimeType':'model/gltf-binary','buffer':glb_bytes()})
 pg.get_by_text('Guardado en este dispositivo.',exact=False).wait_for()
 pg.locator('a[href$="/modelos"]').click(timeout=2500)
 link=pg.get_by_role('link',name='Ver GLB local',exact=True);link.wait_for(timeout=3000)
 assert f'local={project}' in link.get_attribute('href')
 pg.get_by_role('link',name='Showroom',exact=True).click()
 pg.get_by_label('Activar showroom inmersivo',exact=True).check()
 pg.get_by_label('Activar Opening',exact=True).check()
 pg.get_by_label('Fachada inicial',exact=True).select_option('f');pg.get_by_label('Planta de entrada',exact=True).select_option('l')
 # Produce a real decodable WebM. A standard EBML Void pads it beyond cloud caps.
 video=pg.evaluate('''async()=>{const c=document.createElement('canvas');c.width=c.height=16;const g=c.getContext('2d'),stream=c.captureStream(0),track=stream.getVideoTracks()[0],r=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];r.ondataavailable=e=>chunks.push(e.data);const done=new Promise(res=>r.onstop=res);r.start();for(let i=0;i<10;i++){g.fillStyle=i%2?'red':'blue';g.fillRect(0,0,16,16);track.requestFrame();await new Promise(res=>setTimeout(res,60));}r.stop();await done;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));}''')
 assert len(video)>200,'Video fixture has no encoded frames'
 padding=80*1024*1024;path=Path(tmp)/'opening.webm';path.write_bytes(bytes(video)+b'\xec'+((1<<56)|padding).to_bytes(8,'big')+b'\0'*padding)
 pg.get_by_label('Agregar video local',exact=True).set_input_files(str(path))
 pg.get_by_role('status').filter(has_text='Opening guardado en este dispositivo').wait_for()
 pg.get_by_role('button',name='Guardar experiencia en este dispositivo',exact=True).click()
 pg.get_by_role('group',name='Experiencia del showroom',exact=True).get_by_role('status').filter(has_text='Guardado en este dispositivo').wait_for()
 with pg.expect_popup() as p:pg.get_by_role('link',name='Vista previa local',exact=True).click()
 preview=p.value
 preview.locator('.ax-opening video').wait_for()
 preview.wait_for_function("(()=>{const v=document.querySelector('.ax-opening video');return v&&v.readyState>=2&&v.videoWidth===16&&!v.error;})()",timeout=15000)
 assert preview.locator('.ax-opening video').get_attribute('src').startswith('blob:')
 preview.get_by_role('button',name='Iniciar',exact=True).click()
 preview.get_by_role('img',name='Fachada',exact=True).wait_for()
 preview.get_by_role('button',name='Entrar al lobby',exact=True).click()
 preview.get_by_role('img',name='Lobby',exact=True).wait_for()
 preview.get_by_role('button',name='Modelo 3D local',exact=True).click()
 preview.get_by_role('heading',name='Filtros',exact=True).wait_for()
 preview.get_by_role('status').filter(has_text='3 de 3 piezas').wait_for(timeout=15000)
 preview.get_by_role('button',name='Instalaciones',exact=False).click()
 preview.get_by_role('status').filter(has_text='1 de 3 piezas').wait_for()
 assert preview.get_by_role('tab',name='Incidencias',exact=True).count()==0
 assert preview.get_by_text('Responsable',exact=True).count()==0
 preview.get_by_role('link',name='Volver al showroom',exact=True).click()
 preview.get_by_role('img',name='Lobby',exact=True).wait_for()
 assert pg.evaluate("JSON.parse(localStorage.getItem('fixtureWrites')||'[]')")==[]
 preview.get_by_role('button',name='Modelo 3D local',exact=True).click()
 preview.get_by_role('status').filter(has_text='3 de 3 piezas').wait_for(timeout=15000)
 preview.set_viewport_size({'width':390,'height':844});preview.reload()
 preview.get_by_role('status',include_hidden=True).filter(has_text='3 de 3 piezas').wait_for(state='attached',timeout=15000)
 assert not preview.locator('#bm-local-filters').is_visible()
 assert preview.evaluate('document.documentElement.scrollWidth<=innerWidth')
 preview.wait_for_timeout(100);preview.screenshot(path='/tmp/agel-glb-mobile.png')
 preview.get_by_role('button',name='Filtros',exact=True).click()
 assert preview.locator('#bm-local-filters').is_visible()
 preview.evaluate("fixtureChangeOwner('other-owner')")
 preview.get_by_role('heading',name='La cuenta cambió',exact=True).wait_for()
 assert preview.locator('canvas').count()==0
 print('PASS: 80 MiB decodable Opening, GLB listed, facade/lobby/local filters/return, no cloud writes')
