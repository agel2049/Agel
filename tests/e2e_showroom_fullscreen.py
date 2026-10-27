from ui_harness import local_page
with local_page('tests/fixtures/showroom-experience.html') as pg:
 pg.get_by_role('button',name='Iniciar',exact=True).click()
 pg.get_by_role('img',name='Fachada',exact=True).wait_for()
 box=pg.locator('.ax-stage').bounding_box();size=pg.viewport_size
 assert box['width']==size['width'] and box['height']==size['height'],(box,size)
 assert pg.locator('.ax-band').evaluate('(e)=>getComputedStyle(e).borderRadius')=='0px'
 assert pg.get_by_role('button',name='Nivel 1',exact=True).evaluate('(e)=>getComputedStyle(e).borderRadius')=='999px'
 control=pg.get_by_role('button',name='Ubicación',exact=True)
 pg.mouse.move(1190,890);pg.wait_for_timeout(180)
 assert float(control.evaluate('(e)=>getComputedStyle(e).opacity'))<1
 assert 'blur' in control.evaluate('(e)=>getComputedStyle(e).backdropFilter')
 control.hover();pg.wait_for_timeout(180);assert control.evaluate('(e)=>getComputedStyle(e).opacity')=='1'
 assert pg.get_by_role('button',name='Entrar al lobby',exact=True).evaluate('(e)=>getComputedStyle(e).opacity')=='1'
 pg.get_by_role('button',name='Ver imagen completa',exact=True).click()
 assert pg.get_by_role('button',name='Ver imagen completa',exact=True).get_attribute('aria-pressed')=='true'
 print('PASS: full viewport image stage, glass controls fade in on hover, hotspot visibility and fit option')
