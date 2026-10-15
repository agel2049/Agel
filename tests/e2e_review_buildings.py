from ui_harness import local_page
with local_page('tests/fixtures/showroom-experience.html') as pg:
 pg.evaluate("""()=>{
 experience.dispose();manifest.opening.enabled=false;
 manifest.spaces.unshift({id:'tower-a',kind:'edificio',name:'Torre A'},{id:'tower-b',kind:'edificio',name:'Torre B'});
 manifest.spaces.find(s=>s.id==='level').parent_id='tower-a';
 manifest.spaces.push({id:'level-b',parent_id:'tower-b',kind:'nivel',name:'Nivel 1'});
 manifest.content.views.push({id:'floor-b',spaceId:'level-b',role:'floor',title:'Planta B',image:'pano_a.jpg',w:1600,h:900,regions:[],spots:[]});
 navigation=AgelShowroomNavigation.create(manifest);experience=AgelShowroomExperience.mount(document.getElementById('app'),{manifest,navigation,resolveMedia:r=>new URL(r,location.href).href,openTour:()=>({close(){}})});
 }""")
 assert pg.get_by_role('button',name='Torre A · Nivel 1',exact=True).count()==1,'Buildings have ambiguous level names'
 assert pg.get_by_role('button',name='Torre B · Nivel 1',exact=True).count()==1
 pg.get_by_role('button',name='Torre A · Nivel 1',exact=True).click()
 assert pg.locator('.ax-levels [data-level=level-b]').count()==0,'Other building levels still visible'
 assert pg.get_by_role('button',name='Nivel 1',exact=True).count()==1
 print('PASS: building labels disambiguate facade levels; active building filters levels')
