from ui_harness import local_page
with local_page('tests/fixtures/showroom-experience.html') as pg:
 pg.get_by_role('button',name='Iniciar',exact=True).click(timeout=3000)
 pg.get_by_role('img',name='Fachada',exact=True).wait_for()
 pg.get_by_role('button',name='Entrar al lobby',exact=True).click()
 pg.get_by_role('img',name='Lobby',exact=True).wait_for()
 pg.get_by_role('button',name='Ver imagen completa',exact=True).click()
 pg.get_by_role('button',name='Nivel 1',exact=True).click()
 zone=pg.get_by_role('button',name='Departamento 101',exact=True)
 assert zone.evaluate('(el)=>getComputedStyle(el).fill') in ['rgba(0, 0, 0, 0)','transparent']
 zone.hover();pg.wait_for_timeout(200)
 assert zone.evaluate('(el)=>getComputedStyle(el).fill')=='rgba(237, 234, 228, 0.12)'
 assert 'Q' in zone.get_attribute('d')
 zone.click();pg.get_by_role('img',name='Planta departamento 101',exact=True).wait_for()
 pg.get_by_role('button',name='Sala 101',exact=True).first.click()
 assert pg.evaluate('tours[0].sceneId')=='sa'
 assert pg.evaluate('tours[0].spaceId')=='a'
 pg.evaluate('tours[0].onClose()')
 pg.get_by_role('img',name='Planta departamento 101',exact=True).wait_for()
 pg.get_by_role('button',name='Ubicación',exact=True).click()
 pg.get_by_text('Morelia, Michoacán',exact=True).wait_for()
 assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 pg.get_by_role('button',name='Fachada',exact=True).click();pg.get_by_role('img',name='Fachada',exact=True).wait_for();pg.wait_for_timeout(750);pg.screenshot(path='/tmp/agel-experience-desktop.png')
 print('PASS: opening facade lobby level transparent rounded area scoped tour and return')
with local_page('tests/fixtures/showroom-experience.html',{'width':390,'height':844}) as pg:
 pg.emulate_media(reduced_motion='reduce')
 pg.get_by_role('button',name='Iniciar',exact=True).click()
 pg.get_by_role('button',name='Ver imagen completa',exact=True).click()
 pg.get_by_role('button',name='Nivel 1',exact=True).click()
 pg.keyboard.press('Tab')
 pg.get_by_role('button',name='Departamento 101',exact=True).focus()
 assert pg.get_by_role('button',name='Departamento 101',exact=True).evaluate('(el)=>getComputedStyle(el).stroke')=='rgb(237, 234, 228)'
 assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 pg.screenshot(path='/tmp/agel-experience-mobile.png')
 print('PASS: mobile width and keyboard focus with reduced motion')
from pathlib import Path
image=Path(__file__).parent/'fixtures/pano_a.jpg'
with local_page('tests/fixtures/showroom-tour.html',setup=lambda p:p.route('https://fixture.agelarq.test/**',lambda r:r.fulfill(content_type='image/jpeg',body=image.read_bytes()))) as pg:
 pg.get_by_role('button',name='Ver imagen completa',exact=True).click()
 pg.get_by_role('button',name='Nivel 1',exact=True).click()
 pg.locator('.ax-experience').get_by_role('button',name='Departamento 101',exact=True).click()
 pg.get_by_role('img',name='Planta departamento 101',exact=True).wait_for()
 pg.get_by_role('button',name='Sala 101',exact=True).first.click()
 mini=pg.get_by_role('region',name='Plano de ubicación',exact=True);mini.wait_for()
 assert mini.get_by_role('button',name='Sala 102',exact=False).count()==0
 assert pg.locator('.sr-hs-inner').evaluate('(el)=>el.style.transform')=='perspective(300px) rotateX(55deg) rotateZ(20deg) scale(1.2)'
 pg.get_by_role('button',name='Volver al departamento',exact=True).click()
 pg.get_by_role('img',name='Planta departamento 101',exact=True).wait_for()
 pg.wait_for_function("calls.filter(x=>x==='dispose').length===1")
 assert not any('/sb.jpg' in x for x in pg.evaluate('calls'))
 print('PASS: real tour adapter/minimap with simulated engine, scoped scenes, orientation and dispose')
