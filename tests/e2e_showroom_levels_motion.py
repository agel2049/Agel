"""Presentation regressions; panorama is a test adapter, no 360 renderer."""
from ui_harness import local_page

def add_below(pg):
 pg.evaluate("""()=>{document.body.insertAdjacentHTML('beforeend','<section id=contacto style=height:1500px><button>Enviar contacto</button></section>');experience.dispose();navigation=AgelShowroomNavigation.create(manifest);experience=AgelShowroomExperience.mount(document.querySelector('#app'),{manifest,navigation,resolveMedia:r=>new URL(r,location.href).href,openTour:args=>{tours.push(args);return {close(){}};}});} """)

with local_page('tests/fixtures/showroom-experience.html') as pg:
 add_below(pg)
 pg.mouse.wheel(0,1200);pg.keyboard.press('PageDown');pg.wait_for_timeout(100)
 assert pg.evaluate('scrollY')==0,'Opening can scroll into the rest of the website'
 for _ in range(5):
  pg.keyboard.press('Tab');assert pg.evaluate("!document.activeElement.closest('#contacto')"),'Opening leaked focus to background content'
 pg.get_by_role('button',name='Iniciar',exact=True).click()
 pg.get_by_role('img',name='Fachada',exact=True).wait_for()
 assert not pg.locator('#contacto').evaluate('(el)=>el.inert'),'Background stayed inert after Iniciar'
 levels=pg.get_by_role('navigation',name='Niveles',exact=True)
 assert levels.bounding_box()['x']>pg.viewport_size['width']/2,'Levels must live at the right'
 assert pg.get_by_role('navigation',name='Etapas de la presentación').count()==0
 assert pg.locator('.ax-step').count()==0,'Oversized phase number still covers the image'
 assert pg.locator('.ax-band').evaluate('(el)=>Number(getComputedStyle(el).backgroundColor.match(/[\\d.]+/g)[3])')<.5,'Band is opaque'
 assert 'blur' in pg.locator('.ax-band').evaluate('(el)=>getComputedStyle(el).backdropFilter')
 pg.get_by_role('button',name='Ver imagen completa',exact=True).click()
 levels.get_by_role('button',name='Nivel 1',exact=True).click()
 pg.get_by_role('img',name='Planta Nivel 1',exact=True).wait_for()
 pg.get_by_role('button',name='Departamento 101',exact=True).click()
 pg.get_by_role('img',name='Planta departamento 101',exact=True).wait_for()
 pg.get_by_role('button',name='Sala 101',exact=True).click()
 assert pg.evaluate('tours.at(-1).sceneId')=='sa'
 pg.evaluate('tours.at(-1).onClose()')
 pg.get_by_role('img',name='Planta departamento 101',exact=True).wait_for()
 pg.evaluate('scrollTo(0,1000)');assert pg.evaluate('scrollY')>0,'Opening lock was not released'
 pg.evaluate('scrollTo(0,0)')
 pg.get_by_role('button',name='Volver al inicio del proyecto',exact=True).click()
 pg.get_by_role('button',name='Iniciar',exact=True).wait_for()
 pg.evaluate('experience.dispose()')
 pg.evaluate('scrollTo(0,900)');assert pg.evaluate('scrollY')>0,'Disposed Opening left a scroll lock'
 print('PASS: locked Opening, right-hand levels, floor/unit/360 context, transparent glass, lock cleanup')

with local_page('tests/fixtures/showroom-experience.html') as pg:
 pg.evaluate("""()=>{experience.dispose();manifest.scenes.push({id:'bed',name:'Recámara 101'});manifest.spaces.find(s=>s.id==='a').sceneIds.push('bed');navigation=AgelShowroomNavigation.create(manifest);experience=AgelShowroomExperience.mount(document.querySelector('#app'),{manifest,navigation,resolveMedia:r=>new URL(r,location.href).href,openTour:args=>{tours.push(args);return {close(){}};}});navigation.dispatch({type:'OPEN_SPACE',id:'a'});} """)
 pg.get_by_role('img',name='Planta departamento 101',exact=True).wait_for()
 assert pg.get_by_role('button',name='Sala 101',exact=True).count()==1,'Mapped scene is duplicated'
 pg.get_by_role('button',name='Recámara 101',exact=True).click()
 assert pg.evaluate('tours.at(-1).sceneId')=='bed','Unmapped scoped room became unreachable'
 print('PASS: partial room mapping keeps every scoped scene accessible without duplicating hotspots')

for viewport in [{'width':390,'height':844},{'width':320,'height':568}]:
 with local_page('tests/fixtures/showroom-experience.html',viewport) as pg:
  pg.emulate_media(reduced_motion='reduce')
  pg.get_by_role('button',name='Iniciar',exact=True).click()
  pg.get_by_role('img',name='Fachada',exact=True).wait_for()
  levels=pg.get_by_role('navigation',name='Niveles',exact=True)
  assert levels.bounding_box()['x']>viewport['width']/2
  for control in pg.locator('.ax-top button,.ax-levels button').all():
   box=control.bounding_box();assert box['width']>=44 and box['height']>=44
   assert box['x']>=0 and box['x']+box['width']<=viewport['width']
  assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert pg.evaluate("document.getAnimations().filter(a=>a.playState==='running').length")==0
  print('PASS: compact right levels, touch targets and reduced motion',viewport)
