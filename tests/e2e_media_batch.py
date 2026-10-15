import base64
from ui_harness import local_page
with local_page('tests/fixtures/panel-local.html') as pg:
 pg.get_by_role('button',name='Agregar imágenes',exact=True).wait_for()
 png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e8AAAAASUVORK5CYII=')
 pg.get_by_role('button',name='Agregar imágenes',exact=True).locator('..').locator('input').set_input_files([{'name':'a.png','mimeType':'image/png','buffer':png},{'name':'b.png','mimeType':'image/png','buffer':png}])
 pg.wait_for_function("document.querySelectorAll('.pn-media:not(.pn-views) img').length===2",timeout=4000)
 pg.reload();pg.wait_for_function("document.querySelectorAll('.pn-media:not(.pn-views) img').length===2",timeout=4000)
 assert pg.evaluate('writes')==[]
 print('PASS: a multi-file gallery selection persists all files sequentially without cloud writes')
