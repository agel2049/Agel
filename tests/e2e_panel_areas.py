"""Tests only the new area editor; never opens the 360 viewer or remote Supabase."""
import functools,http.server,json,threading,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('AGEL_BROWSER_EXECUTABLE') or ('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' if Path('/Applications/Google Chrome.app').exists() else None),headless=True)
  pg=browser.new_page(viewport={'width':1200,'height':900})
  pg.goto(f'http://127.0.0.1:{server.server_port}/tests/fixtures/area-editor.html')
  pg.get_by_role('button',name='Dibujar zonas',exact=True).click()
  assert pg.get_by_role('button',name='90°',exact=True).count()==1,'Missing orthogonal drawing toggle'
  assert pg.get_by_label('Zona de',exact=True).input_value()=='a','Drawing defaults to a different space'
  toggle=pg.get_by_role('button',name='90°',exact=True);toggle.click()
  stage=pg.locator('.pn-vstage');box=stage.bounding_box()
  for x,y in [(0.1,0.1),(0.4,0.12)]:stage.click(position={'x':box['width']*x,'y':box['height']*y})
  toggle.click()
  assert pg.locator('.pn-vpt').count()==2,'Toggling erased existing vertices'
  for x,y in [(0.5,0.5),(0.1,0.5)]:stage.click(position={'x':box['width']*x,'y':box['height']*y})
  pg.get_by_role('button',name='Cerrar zona',exact=True).click()
  pg.get_by_label('Redondear esquinas',exact=True).check()
  pg.get_by_label('Radio de esquinas (%)',exact=True).fill('1')
  pg.get_by_role('button',name='Colocar escenas 360°',exact=True).click()
  select=pg.get_by_label('Escena 360°',exact=True)
  assert select.locator('option').all_text_contents()==['Sala 101'],'Sibling scene leaked into department'
  stage.click(position={'x':box['width']*.25,'y':box['height']*.25})
  pg.get_by_role('button',name='Listo y guardar',exact=True).click()
  data=json.loads(pg.locator('#saved').inner_text())
  points=data['regions'][0]['points']
  assert points[0][1]==points[1][1],'Orthogonal segment is not horizontal'
  for got,want in zip(points,[[10,10],[40,10],[50,50],[10,50]]):
   assert all(abs(a-b)<0.2 for a,b in zip(got,want)),points
  assert data['regions'][0]['space']=='a'
  assert data['regions'][0]['radius']==1 and data['spots'][0]['scene']=='sa'
  pg.get_by_role('button',name='Dibujar zonas',exact=True).click()
  expect(pg.get_by_label('Radio de esquinas (%)',exact=True)).to_have_value('1')
  pg.get_by_label('Esta vista corresponde a',exact=True).select_option('b')
  expect(pg.get_by_role('alert')).to_contain_text('fuera del alcance')
  pg.get_by_role('button',name='Cancelar',exact=True).click()
  assert json.loads(pg.locator('#saved').inner_text())['spaceId']=='a'
  browser.close()
  print('PASS: scoped scenes, orthogonal toggle, rounded persistence, safe cancellation and incompatible point notice')
finally:server.shutdown()
