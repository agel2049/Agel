import re
from pathlib import Path
from ui_harness import local_page
from ifc_fixture import ifc_bytes
project='10000000-0000-4000-8000-000000000001'
def setup(pg):
 pg.route('**/packages/core/cloud.js',lambda r:r.fulfill(path=str(Path(__file__).parent/'fixtures/local-experience-cloud.js'),content_type='text/javascript'))
 pg.route('https://fixture.agelarq.test/**',lambda r:r.fulfill(path=str(Path(__file__).parent/'fixtures/pano_a.jpg'),content_type='image/jpeg'))
with local_page(f'apps/panel/#/p/{project}/showroom',setup=setup) as pg:
 upload=pg.get_by_role('button',name='Agregar modelo local (GLB o IFC)',exact=True).locator('..').locator('input[type=file]')
 upload.set_input_files({'name':'Edificio.ifc','mimeType':'application/x-step','buffer':ifc_bytes()})
 pg.get_by_text(re.compile('IFC preparado · 4 piezas')).wait_for(timeout=20000)
 ref=pg.get_by_label('Archivo GLB (URL https)',exact=True).input_value();assert ref.startswith('agel-local:')
 pg.reload();assert pg.get_by_label('Archivo GLB (URL https)',exact=True).input_value()==ref
 upload=pg.get_by_role('button',name='Agregar modelo local (GLB o IFC)',exact=True).locator('..').locator('input[type=file]')
 upload.set_input_files({'name':'Edificio.ifc','mimeType':'application/x-step','buffer':ifc_bytes()})
 pg.get_by_text(re.compile('Copia IFC reutilizada · 4 piezas')).wait_for(timeout=10000)
 assert pg.get_by_label('Archivo GLB (URL https)',exact=True).input_value()==ref
 upload.set_input_files({'name':'incorrecto.ifc','mimeType':'application/x-step','buffer':b'not an IFC'})
 pg.get_by_text(re.compile('no es un IFC STEP')).wait_for()
 assert pg.get_by_label('Archivo GLB (URL https)',exact=True).input_value()==ref
 assert pg.evaluate("JSON.parse(localStorage.getItem('fixtureWrites')||'[]')")==[]
 pg.locator('a[href$="/modelos"]').click()
 pg.get_by_role('link',name='Ver GLB local',exact=True).wait_for()
 print('PASS: real panel IFC import, saved model/reload/cache, invalid input preserves previous model, no cloud writes')
