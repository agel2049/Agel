from ui_harness import local_page
def case_0():
 with local_page('tests/fixtures/d5-local.html') as pg:
  pg.wait_for_function('window.d5FixtureReady')
  assert pg.evaluate("""async()=>{localStorage.setItem(D5_SAVE_KEY,JSON.stringify({v:2,models:[{name:'Legado',url:'https://example.test/a.html'}],projName:'Proyecto anterior',videoUrl:'https://example.test/open.mp4',btnText:'Ir'}));await d5Load();return d5Models[0]?.name==='Legado'&&document.getElementById('d5ProjName').value==='Proyecto anterior';}"""),'Legacy D5 data disappeared'
  print('PASS: prior D5 project migrated without deleting legacy record')

def case_1():
 with local_page('tests/fixtures/d5-local.html') as pg:
  pg.wait_for_function('window.d5FixtureReady')
  assert pg.evaluate("""async()=>{await d5Load();d5Models=[{name:'Invitado',url:'https://example.test/guest.html'}];await d5Save();const account=await AgelLocalMedia.open({ownerId:'user-a',projectId:'d5-personal'});await account.saveDraft({v:2,models:[{name:'Cuenta',url:'https://example.test/account.html'}]});owner='user-a';try{await d5Save();}catch{}return (await account.loadDraft()).models[0].name==='Cuenta';}"""),'Guest globals overwrote account D5 draft'
  print('PASS: stale guest state cannot overwrite an authenticated draft')

def case_2():
 with local_page('tests/fixtures/d5-local.html') as pg:
  pg.wait_for_function('window.d5FixtureReady')
  assert pg.evaluate("""async()=>{await d5Load();const original=AgelLocalMedia.open;AgelLocalMedia.open=async args=>({...await original(args),saveDraft:async()=>{throw Error('No hay espacio local');}});await d5HandleVideo({target:{files:[new File(['video'],'open.mp4',{type:'video/mp4'})],value:''}});return !messages.some(x=>/guardado/i.test(x))&&messages.some(x=>/espacio/.test(x));}"""),'Video falsely reported a successful draft save'
  print('PASS: failed D5 draft persistence never reports success')

def case_3():
 with local_page('tests/fixtures/d5-local.html') as pg:
  pg.wait_for_function('window.d5FixtureReady')
  assert pg.evaluate("""()=>{_d5NextActionLocal=false;d5HandleFileSelect({target:{files:[new File(['html'],'model.html',{type:'text/html'})],value:''}});const explicit=lastLocal===false;d5HandleFileSelect({target:{files:[new File(['html'],'next.html',{type:'text/html'})],value:''}});return explicit&&lastLocal===true;}"""),'Explicit cloud selection incorrectly selected local mode'
  print('PASS: explicit cloud choice is preserved while local remains the default')

def case_4():
 with local_page('tests/fixtures/d5-local.html') as pg:
  pg.wait_for_function('window.d5FixtureReady')
  assert pg.evaluate("""async()=>{await d5Load();document.getElementById('d5UplModelName').value='Nuevo';_d5UplLocalFile=new File(['html'],'new.html',{type:'text/html'});const original=AgelLocalMedia.open;AgelLocalMedia.open=async args=>({...await original(args),saveDraft:async()=>{throw Error('No hay espacio local');}});await d5ConfirmUpload();return !messages.some(x=>/agregado/.test(x))&&d5Models.length===0&&_d5UplLocalFile!==null;}"""),'Model import falsely reported persistence'
  print('PASS: failed D5 model draft preserves selection and reports no success')

failures=[]
for case in [case_0,case_1,case_2,case_3,case_4]:
 try:case()
 except Exception as e:failures.append(str(e));print("FAIL:",str(e).splitlines()[0],flush=True)
assert not failures, failures
