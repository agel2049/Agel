from ui_harness import local_page
with local_page('tests/fixtures/experience-settings.html') as pg:
 pg.get_by_label('Activar showroom inmersivo',exact=True).check()
 pg.get_by_label('Activar Opening',exact=True).check(timeout=3000)
 pg.get_by_label('Fachada inicial',exact=True).select_option('f')
 pg.get_by_label('Planta de entrada',exact=True).select_option('l')
 pg.get_by_label('Superficie de Material',exact=True).select_option('floor')
 pg.get_by_role('button',name='Guardar experiencia en este dispositivo',exact=True).click()
 pg.get_by_role('status').filter(has_text='Guardado en este dispositivo').wait_for()
 assert pg.evaluate('writes')==[]
 pg.reload();assert pg.get_by_label('Activar Opening',exact=True).is_checked()
 pg.get_by_text('Usar video o póster por enlace',exact=True).click()
 assert pg.get_by_text('Ending',exact=True).count()==0
 pg.get_by_label('Video de presentación (URL HTTPS)',exact=True).fill('javascript:alert(1)')
 pg.get_by_role('button',name='Guardar experiencia en este dispositivo',exact=True).click()
 pg.get_by_role('alert').filter(has_text='HTTPS').wait_for()
 print('PASS: persistent Opening, facade/lobby settings, no cloud writes, invalid URL blocked')
