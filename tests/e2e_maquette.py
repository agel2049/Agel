import os,json
from pathlib import Path
from urllib.parse import urlparse
from ui_harness import local_page
from glb_fixture import glb_bytes,maquette_building_bytes
vendor=Path(os.environ.get('AGEL_THREE_VENDOR',str(Path(__file__).parent/'vendor/node_modules/three')))
def setup(pg):
 pg.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**',lambda r:r.fulfill(path=str(vendor/urlparse(r.request.url).path.split('three@0.128.0/')[1])))
with local_page('tests/fixtures/maquette.html',setup=setup) as pg:
 assert pg.evaluate('typeof window.AgelMaquette')=='object','Shared maquette interface missing'
 requests=[];pg.on('request',lambda r:requests.append((r.method,r.url)))
 pg.evaluate('mountMaquette',list(glb_bytes()))
 pg.get_by_role('status').filter(has_text='3 de 3 piezas').wait_for()
 pg.get_by_role('combobox',name='Vista de maqueta').select_option('top')
 pg.get_by_role('button',name='Acercar maqueta',exact=True).click()
 pg.get_by_role('button',name='Giro automático',exact=True).click()
 assert pg.get_by_role('button',name='Giro automático',exact=True).get_attribute('aria-pressed')=='true'
 pg.get_by_role('button',name='Giro automático',exact=True).click()
 pg.get_by_role('button',name='Instalaciones (1)',exact=True).click()
 pg.get_by_role('status').filter(has_text='1 de 3 piezas').wait_for()
 pg.get_by_role('searchbox',name='Buscar piezas').fill('inexistente')
 pg.get_by_role('status').filter(has_text='0 de 3 piezas').wait_for()
 assert pg.get_by_role('button',name='Ver en mi espacio',exact=True).is_disabled()
 pg.get_by_role('button',name='Ver todo',exact=True).click()
 canvas=pg.locator('canvas');canvas.focus();before=canvas.screenshot();canvas.press('w');pg.wait_for_timeout(100)
 assert before!=canvas.screenshot(),'Keyboard did not pan the maquette'
 pg.get_by_role('searchbox',name='Buscar piezas').fill('Walls')
 pg.get_by_role('searchbox',name='Buscar piezas').press('w')
 assert pg.get_by_role('searchbox',name='Buscar piezas').input_value()=='Wallsw','WASD consumed a text input'
 pg.get_by_role('button',name='Ver todo',exact=True).click()
 pg.evaluate('maquette.dispose()');pg.evaluate('mountMaquette',list(maquette_building_bytes()));pg.wait_for_timeout(100)
 pg.screenshot(path='/tmp/agel-maquette-desktop.png')
 pg.set_viewport_size({'width':390,'height':844});pg.evaluate('maquette.dispose()');pg.evaluate('mountMaquette',list(maquette_building_bytes()));pg.wait_for_timeout(100)
 assert not pg.locator('#bm-local-filters').is_visible()
 assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 pg.screenshot(path='/tmp/agel-maquette-mobile.png')
 pg.get_by_role('button',name='Filtros',exact=True).click();assert pg.locator('#bm-local-filters').is_visible()
 pg.get_by_role('button',name='Cerrar maqueta',exact=True).click();assert pg.evaluate('closedMaquette')
 assert pg.locator('canvas').count()==0
 assert not any(method!='GET' or 'supabase' in url or 'autodesk' in url for method,url in requests),requests
 print('PASS: maquette controls, filters, keyboard scope, responsive UI, cleanup and zero cloud writes')

def public_setup(pg):
 setup(pg)
 raw=json.loads((Path(__file__).parent/'fixtures/showroom-experience.json').read_text())
 raw['showroom']['model3d']={'url':'https://fixture.agelarq.test/maqueta.glb','title':'Maqueta publicada'}
 pg.context.route('**/packages/core/cloud.js',lambda r:r.fulfill(content_type='text/javascript',body='window.AgelCloud={client:()=>({user:null,session:null,rpc:async name=>name==="get_publication"?'+json.dumps({'snapshot':raw,'version':1})+':null})};'))
 pg.context.route('https://fixture.agelarq.test/maqueta.glb',lambda r:r.fulfill(content_type='model/gltf-binary',body=glb_bytes()))
 pg.context.route('https://fixture.agelarq.test/**.jpg',lambda r:r.fulfill(content_type='image/jpeg',path=str(Path(__file__).parent/'fixtures/pano_a.jpg')))
with local_page('apps/showroom/?p=maqueta',setup=public_setup) as pg:
 trigger=pg.get_by_role('button',name='Maqueta virtual',exact=True);trigger.click()
 pg.get_by_role('dialog',name='Maqueta virtual').get_by_role('status').filter(has_text='3 de 3 piezas').wait_for()
 pg.get_by_role('button',name='Instalaciones (1)',exact=True).click()
 pg.get_by_role('status').filter(has_text='1 de 3 piezas').wait_for()
 pg.get_by_role('button',name='Cerrar maqueta',exact=True).click()
 assert pg.get_by_role('dialog',name='Maqueta virtual').count()==0
 assert trigger.evaluate('(el)=>el===document.activeElement')
 pg.get_by_role('button',name='Ver en 3D',exact=True).click()
 pg.get_by_role('dialog',name='Maqueta virtual').get_by_role('status').filter(has_text='3 de 3 piezas').wait_for()
 pg.keyboard.press('Escape');pg.locator('.mq-dialog').wait_for(state='detached')
 print('PASS: public facade opens a shared maquette, filters, returns focus and reopens from model section')

def iphone_setup(pg):
 setup(pg)
 pg.add_init_script('''Object.defineProperty(navigator,'platform',{value:'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{value:5});window.fixtureAR=0;customElements.define('model-viewer',class extends HTMLElement{get canActivateAR(){return true;}connectedCallback(){queueMicrotask(()=>this.dispatchEvent(new Event('load')));}activateAR(){window.fixtureAR++;return Promise.resolve();}});''')
with local_page('tests/fixtures/maquette.html',setup=iphone_setup) as pg:
 pg.evaluate('mountMaquette',list(glb_bytes()))
 pg.get_by_role('button',name='Preparar AR',exact=True).click()
 pg.get_by_role('button',name='Ver en mi espacio',exact=True).wait_for()
 assert pg.locator('model-viewer').get_attribute('src').startswith('blob:')
 assert pg.locator('model-viewer').get_attribute('ar-modes')=='quick-look'
 pg.get_by_role('button',name='Ver en mi espacio',exact=True).click();assert pg.evaluate('fixtureAR')==1
 pg.get_by_role('button',name='Cerrar maqueta',exact=True).click()
 assert pg.locator('model-viewer').count()==0
 print('PASS: Quick Look preparation uses local Blob, explicit second action, complete-model notice and cleanup (native viewer simulated)')
