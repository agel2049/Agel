from ui_harness import local_page
with local_page('tests/fixtures/showroom-experience.html') as pg:
 pg.get_by_role('button',name='Ver proyecto',exact=True).click(timeout=3000)
 pg.get_by_role('img',name='Fachada',exact=True).wait_for()
 pg.get_by_role('button',name='Entrar al lobby',exact=True).click()
 pg.get_by_role('img',name='Lobby',exact=True).wait_for()
 pg.get_by_role('button',name='Nivel 1',exact=True).click()
 zone=pg.get_by_role('button',name='Departamento 101',exact=True)
 assert zone.evaluate('(el)=>getComputedStyle(el).fill') in ['rgba(0, 0, 0, 0)','transparent']
 zone.hover();pg.wait_for_timeout(200)
 assert zone.evaluate('(el)=>getComputedStyle(el).fill')=='rgba(184, 157, 116, 0.14)'
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
 pg.get_by_role('button',name='Fachada',exact=True).click();pg.get_by_role('img',name='Fachada',exact=True).wait_for();pg.wait_for_timeout(500);pg.screenshot(path='/tmp/agel-experience-desktop.png')
 print('PASS: opening facade lobby level transparent rounded area scoped tour and return')
with local_page('tests/fixtures/showroom-experience.html',{'width':390,'height':844}) as pg:
 pg.emulate_media(reduced_motion='reduce')
 pg.get_by_role('button',name='Ver proyecto',exact=True).click()
 pg.get_by_role('button',name='Nivel 1',exact=True).click()
 pg.keyboard.press('Tab')
 pg.get_by_role('button',name='Departamento 101',exact=True).focus()
 assert pg.get_by_role('button',name='Departamento 101',exact=True).evaluate('(el)=>getComputedStyle(el).stroke')=='rgb(184, 157, 116)'
 assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 pg.screenshot(path='/tmp/agel-experience-mobile.png')
 print('PASS: mobile width and keyboard focus with reduced motion')
