"""Presentation boundary: local files survive reload, without a cloud upload."""
from pathlib import Path
from ui_harness import local_page

with local_page('tests/fixtures/experience-settings.html') as pg:
 pg.get_by_label('Agregar video local',exact=True).set_input_files({'name':'opening.webm','mimeType':'video/webm','buffer':(Path(__file__).parent/'fixtures/share-opening.webm').read_bytes()})
 pg.get_by_role('status').filter(has_text='Opening guardado en este dispositivo').wait_for(timeout=4000)
 pg.reload()
 assert pg.get_by_label('Activar Opening',exact=True).is_checked()
 pg.locator('.pn-opening-preview video').wait_for()
 pg.wait_for_function("document.querySelector('.pn-opening-preview video').readyState>=2")
 assert pg.locator('.pn-opening-preview video').get_attribute('src').startswith('blob:')
 assert pg.evaluate('writes')==[]
 pg.get_by_role('button',name='Quitar video del Opening',exact=True).click()
 pg.get_by_role('status').filter(has_text='Video retirado del Opening').wait_for()
 pg.get_by_role('button',name='Guardar experiencia en este dispositivo',exact=True).click()
 pg.get_by_role('status').filter(has_text='Guardado en este dispositivo').wait_for()
 pg.reload()
 assert not pg.get_by_label('Activar Opening',exact=True).is_checked()
 assert pg.locator('.pn-opening-preview video').count()==0
 print('PASS: selecting video saves and enables Opening, decodes after reload, removes without upload')

with local_page('tests/fixtures/showroom-experience.html') as pg:
 assert pg.locator('.ax-opening button').count()==1
 assert pg.locator('.ax-opening h1,.ax-opening p,.ax-opening a').count()==0
 assert pg.locator('.ax-opening .ax-logo').count()==1
 pg.get_by_role('button',name='Iniciar',exact=True).click()
 pg.get_by_role('img',name='Fachada',exact=True).wait_for()
 assert pg.locator('.ax-brand').inner_text()==''
 pg.get_by_role('button',name='Inicio',exact=True).click()
 pg.get_by_role('button',name='Iniciar',exact=True).wait_for()
 print('PASS: logo-only Opening with one Iniciar action, facade navigation and return')

with local_page('tests/fixtures/experience-settings.html') as pg:
 pg.get_by_label('Activar Opening',exact=True).wait_for()
 pg.evaluate("""async()=>{const w=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'p'}),d=await w.load();d.showroom.opening={enabled:true,videoUrl:'https://example.test/legacy.mp4'};await w.save(d);}""")
 pg.reload()
 pg.get_by_role('button',name='Quitar video del Opening',exact=True).click()
 pg.get_by_role('status').filter(has_text='Video retirado del Opening').wait_for()
 pg.get_by_role('button',name='Guardar experiencia en este dispositivo',exact=True).click()
 pg.get_by_role('status').filter(has_text='Guardado en este dispositivo').wait_for()
 pg.reload()
 pg.get_by_label('Activar Opening',exact=True).wait_for()
 assert pg.evaluate("""async()=>{const w=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'p'}),o=(await w.load()).showroom.opening;return !o.video&&!o.videoUrl;}"""),'Legacy video reference was retained'
 assert pg.locator('.pn-opening-preview video').count()==0,'Legacy video alias reappeared'
 print('PASS: removing a legacy Opening clears its old video alias')

with local_page('tests/fixtures/showroom-experience.html',{'width':320,'height':568}) as pg:
 pg.get_by_role('button',name='Iniciar',exact=True).click()
 pg.get_by_role('img',name='Fachada',exact=True).wait_for()
 for b in pg.locator('.ax-top button').all():
  box=b.bounding_box();assert box['x']>=0 and box['x']+box['width']<=320,(b.inner_text(),box)
 pg.get_by_role('button',name='Pantalla completa',exact=True).click()
 pg.wait_for_function('document.fullscreenElement')
 assert pg.evaluate('document.fullscreenElement===document.documentElement'),'Contact is excluded from fullscreen'
 print('PASS: 320px controls stay reachable and fullscreen includes the contact section')
