from ui_harness import local_page
# A second workspace instance represents another tab editing the same IndexedDB draft.
with local_page('tests/fixtures/panel-local.html') as pg:
 pg.get_by_label('Frase principal',exact=True).wait_for()
 pg.evaluate("""async()=>{const w=await AgelWorkspace.open({cloud:AgelCloud.client(),ownerId:'owner',projectId:'p'}),d=await w.load();d.showroom.description='Cambio de otra pestaña';await w.save(d);}""")
 pg.get_by_label('Frase principal',exact=True).fill('Formulario anterior')
 pg.get_by_role('button',name='Guardar en este dispositivo',exact=True).click()
 pg.get_by_role('alert').filter(has_text='otra pestaña').wait_for(timeout=3000)
 assert pg.evaluate("""async()=>{const w=await AgelWorkspace.open({cloud:AgelCloud.client(),ownerId:'owner',projectId:'p'});return (await w.load()).showroom.description;}""")=='Cambio de otra pestaña'
 print('PASS: stale showroom controls cannot overwrite a newer draft')
with local_page('tests/fixtures/experience-settings.html') as pg:
 pg.get_by_label('Texto del botón',exact=True).wait_for()
 pg.evaluate("""async()=>{const w=await AgelWorkspace.open({cloud,ownerId:'owner',projectId:'p'}),d=await w.load();d.showroom.opening={button:'Otra pestaña'};await w.save(d);}""")
 pg.get_by_label('Texto del botón',exact=True).fill('Anterior')
 pg.get_by_role('button',name='Guardar experiencia en este dispositivo',exact=True).click()
 pg.get_by_role('alert').filter(has_text='otra pestaña').wait_for(timeout=3000)
 print('PASS: stale experience controls preserve another tab')
with local_page('tests/fixtures/workspace.html') as pg:
 assert pg.evaluate("""async()=>{const w=await AgelWorkspace.open({cloud,ownerId:owner,projectId:'project-a'});await w.updateSpace({id:'building',name:'Torre',kind:'edificio'});await w.updateSpace({id:'floor',parent_id:'building',name:'Nivel',kind:'nivel'});try{await w.updateSpace({id:'building',parent_id:'floor'});return false;}catch(e){return /cíclic|descendiente/.test(e.message);}}"""),'Cyclic reparent accepted'
 print('PASS: cyclic reparenting rejected before catalog corruption')
with local_page('tests/fixtures/panel-local.html') as pg:
 pg.get_by_role('link',name='Catálogo',exact=True).click()
 pg.get_by_role('button',name='Nuevo espacio',exact=True).click()
 pg.get_by_label('Nombre',exact=True).fill('Formulario anterior')
 pg.evaluate("""async()=>{const w=await AgelWorkspace.open({cloud:AgelCloud.client(),ownerId:'owner',projectId:'p'});await w.updateSpace({name:'Cambio externo',kind:'unidad'});}""")
 pg.locator('.ag-modal').get_by_role('button',name='Guardar',exact=True).click()
 pg.get_by_role('alert').filter(has_text='otra pestaña').wait_for(timeout=3000)
 print('PASS: stale catalog dialog cannot overwrite or add to a newer catalog')
