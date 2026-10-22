"""Real receiver/showroom UI; mock only the worker and remote transport boundaries."""
import json,time
from pathlib import Path
from ui_harness import local_page

ROOT=Path(__file__).resolve().parent.parent
PROJECT='10000000-0000-4000-8000-000000000001'
SESSION='10000000-0000-4000-8000-000000000002'
ASSET='10000000-0000-4000-8000-000000000003'
expires=int(time.time()*1000)+600000
snapshot=json.loads((ROOT/'tests/fixtures/showroom-experience.json').read_text())
snapshot['showroom'].pop('experience',None)
image=f'https://agel-share.invalid/{ASSET}.jpg'
pdf=f'https://agel-share.invalid/{ASSET}.pdf'
snapshot['showroom']['plans']=[{'url':image,'title':'Plano temporal'},{'url':pdf,'title':'Plano PDF'}]
snapshot['spaces'][1]['plan_url']=image
snapshot['spaces'][1]['gallery']=[{'url':image,'caption':'Interior temporal'}]
manifest=json.dumps({'expiresAt':expires,'snapshot':snapshot})

def setup(page):
 page.route('**/packages/core/cloud.js',lambda r:r.fulfill(body="window.AgelCloud={client:()=>({user:{id:'owner',email:'test@example.test'},storageKey:'agel.session',onAuth:()=>()=>{}})};",content_type='text/javascript'))
 page.route('**/packages/sharing/peer.js',lambda r:r.fulfill(body="window.AgelSharePeer={guest(options){queueMicrotask(()=>options.onChannel(new EventTarget()));return {ready:Promise.resolve(),close(){}};}};",content_type='text/javascript'))
 page.route('**/packages/sharing/transfer.js',lambda r:r.fulfill(body=f"window.AgelShareTransfer={{receive:()=>({{fetchBlob:async()=>new Blob([{json.dumps(manifest)}]),close(){{}}}})}};",content_type='text/javascript'))
 page.route('**/apps/share/media/**',lambda r:r.fulfill(path=str(ROOT/'tests/fixtures/pano_a.jpg'),content_type='image/jpeg'))
 page.route('https://fixture.agelarq.test/**',lambda r:r.fulfill(path=str(ROOT/'tests/fixtures/pano_a.jpg'),content_type='image/jpeg'))
 page.add_init_script("""const worker=new EventTarget();worker.register=async()=>{};worker.ready=Promise.resolve();worker.controller={scriptURL:location.origin+'/apps/share/media-worker.js',postMessage(){}};Object.defineProperty(navigator,'serviceWorker',{value:worker});""")

with local_page(f'apps/share/#project={PROJECT}&session={SESSION}&key={"k"*43}&expires={expires}',setup=setup) as page:
 plan=page.get_by_role('link',name='Plano temporal',exact=True)
 plan.wait_for()
 # A new browsing context cannot use a worker URL bound to this receiver.
 pages_before=len(page.context.pages)
 plan.click()
 page.locator('dialog.sr-lightbox[open]').wait_for(timeout=2500)
 assert len(page.context.pages)==pages_before
 assert page.locator('dialog.sr-lightbox img').get_attribute('src').endswith(f'/{ASSET}.jpg')
 page.get_by_role('button',name='Cerrar',exact=True).click()
 page.wait_for_function("document.activeElement?.textContent.includes('Plano temporal')")
 page.evaluate("location.hash='contacto'")
 assert page.locator('#share-banner').is_visible()
 assert page.get_by_role('link',name='Plano PDF',exact=True).get_attribute('target')=='_blank'
 # Unit media is created after hydration, so delegation must cover its drawer too.
 page.locator('.sr-unit-open').first.click()
 drawer=page.locator('dialog.sr-drawer')
 for selector in ['a:has(.sr-plan)','.sr-drawer-shots a']:
  link=drawer.locator(selector)
  link.click()
  page.locator('dialog.sr-lightbox[open]').wait_for()
  page.keyboard.press('Escape')
  page.locator('dialog.sr-lightbox').wait_for(state='detached')
  assert link.evaluate('(el)=>document.activeElement===el')
 assert len(page.context.pages)==pages_before
 print('PASS: temporary plan/unit/gallery images use same-page dialogs, close returns focus, anchors preserve receiver and PDFs retain navigation')
