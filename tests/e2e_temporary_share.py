"""Two isolated browsers, real WebRTC, in-memory test signaling; no production service."""
import functools,http.server,json,os,threading,tempfile,time
from pathlib import Path
from urllib.parse import parse_qs,urlparse
from playwright.sync_api import sync_playwright
from glb_fixture import glb_bytes
ROOT=Path(__file__).resolve().parent.parent
PROJECT='10000000-0000-4000-8000-000000000001'
class Handler(http.server.SimpleHTTPRequestHandler):
 messages=[];lock=threading.Lock()
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path.startswith('/_share_signal?'):
   p=parse_qs(urlparse(self.path).query)
   with self.lock:data=[m for m in self.messages if m['room']==p['room'][0] and m['id']>int(p['after'][0])]
   raw=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
  super().do_GET()
 def do_POST(self):
  if self.path!='/_share_signal':self.send_error(404);return
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  assert len(json.dumps(data))<30000,'Media escaped through signaling'
  with self.lock:data['id']=len(self.messages)+1;self.messages.append(data)
  self.send_response(200);self.send_header('Content-Length','0');self.end_headers()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}/'
try:
 with sync_playwright() as p,tempfile.TemporaryDirectory() as tmp:
  executable=os.environ.get('AGEL_BROWSER_EXECUTABLE')
  browser=p.chromium.launch(executable_path=executable,headless=True)
  host=browser.new_context(viewport={'width':1200,'height':900});guest=browser.new_context(viewport={'width':390,'height':844})
  transport=(ROOT/'packages/sharing/transfer.js').read_text()+"\nfor(const method of ['serve','receive']){const original=AgelShareTransfer[method];AgelShareTransfer[method]=(c,o)=>{if(method==='serve')o={...o,assets:new Map([...o.assets].map(([id,entry])=>[id,{getBlob:async()=>{const blob=await entry.getBlob(),head=await blob.slice(0,4).arrayBuffer();if(head.byteLength===4&&new DataView(head).getUint32(0,true)===0x46546c67)window.__sentGlb=(window.__sentGlb||0)+1;return blob;}}]))};return original(c,{...o,onProgress:p=>{window.__bytes=(window.__bytes||0)+p.bytes;}});};}"
  glb_viewer=(ROOT/'packages/bim/glb-viewer.js').read_text()+"\n{const original=AgelGLB.open;AgelGLB.open=(container,options)=>original(container,{...options,onFrame:canvas=>{window.__drawFrames=(window.__drawFrames||0)+1;window.__drawSize=[canvas.width,canvas.height,canvas.clientWidth,canvas.clientHeight];window.__sourceData=canvas.toDataURL();try{options.onFrame?.(canvas);}catch(e){window.__captureError=e.stack;throw e;}}});}"
  cloud=(ROOT/'tests/fixtures/local-experience-cloud.js').read_text()
  cloud=cloud.replace("(function(){","(function(){if(window.__shareGuest){window.AgelCloud={client(){window.__authCalls=(window.__authCalls||0)+1;throw Error('Visitor must not access account state');}};return;}",1)
  for ctx in (host,guest):
   ctx.add_init_script("window.__pcs=[];const NativePC=window.RTCPeerConnection;window.RTCPeerConnection=class extends NativePC{constructor(...args){super(...args);window.__pcs.push(this);}};")
   ctx.route('**/packages/bim/glb-viewer.js',lambda r:r.fulfill(body=glb_viewer,content_type='text/javascript'))
   ctx.route('**/packages/core/cloud.js',lambda r:r.fulfill(body=cloud,content_type='text/javascript'))
   ctx.route('**/packages/sharing/transfer.js',lambda r:r.fulfill(body=transport,content_type='text/javascript'))
   ctx.route('**/packages/sharing/signal.js',lambda r:r.fulfill(path=str(ROOT/'tests/fixtures/temporary-share-signal.js'),content_type='text/javascript'))
   ctx.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**',lambda r:r.fulfill(path=str(ROOT/'tests/vendor/node_modules/three'/urlparse(r.request.url).path.split('three@0.128.0/')[1])))
   ctx.route('https://fixture.agelarq.test/**',lambda r:r.fulfill(path=str(ROOT/'tests/fixtures/pano_a.jpg'),content_type='image/jpeg'))
  backend_requests=[]
  guest.on('request',lambda req:backend_requests.append(req.url) if any(p in req.url for p in ['/auth/v1/','/rest/v1/','/storage/v1/']) else None)
  guest.add_init_script("window.__shareGuest=true;window.__idbWrites=0;const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...a)=>{window.__idbWrites++;return open(...a);};")
  page=host.new_page();page.goto(base+f'apps/panel/#/p/{PROJECT}/showroom')
  page.get_by_role('button',name='Compartir temporalmente',exact=True).wait_for()
  setup_script='''async project=>{
   const cloud=AgelCloud.client(),ws=await AgelWorkspace.open({cloud,ownerId:cloud.user.id,projectId:project}),d=await ws.load();
   const photo=await ws.addMedia(new File([await (await fetch('https://fixture.agelarq.test/pano.jpg')).blob()],'photo.jpg',{type:'image/jpeg'}));
   const model=await ws.addMedia(new File([new Uint8Array(window.__glb)],'model.glb',{type:'model/gltf-binary'}));
   const encoded=new Uint8Array(window.__video);
   const padding=80*1024*1024,size=new Uint8Array(8);let n=BigInt(padding)|(1n<<56n);for(let i=7;i>=0;i--){size[i]=Number(n&255n);n>>=8n;}
   const video=await ws.addMedia(new File([encoded,new Uint8Array([0xec]),size,new Uint8Array(padding)],'opening.webm',{type:'video/webm'}));
   const next=await ws.load();next.privateSettings={apsToken:'DO_NOT_SHARE_TOKEN'};next.tree.project.owner_id='DO_NOT_SHARE_OWNER';
   next.showroom.model3d={url:model.ref,title:'Modelo temporal'};next.showroom.experience={version:1,facadeViewId:'f',entryTargetViewId:'l'};next.showroom.opening={enabled:true,video:video.ref};next.showroom.views.forEach(v=>v.image=photo.ref);await ws.save(next);window.__shareWorkspace=ws;
  }'''
  # Prepare all media in one source workspace; large bytes never touch the signal provider.
  page.evaluate('data=>window.__glb=data',list(glb_bytes()))
  page.evaluate('data=>window.__video=data',list((ROOT/'tests/fixtures/share-opening.webm').read_bytes()))
  page.evaluate(setup_script,PROJECT)
  page.reload();page.get_by_role('button',name='Compartir temporalmente',exact=True).click()
  link=page.get_by_label('Enlace temporal',exact=True);link.wait_for(timeout=6000)
  url=link.input_value();assert '#project=' in url
  page.evaluate("()=>dispatchEvent(new StorageEvent('storage',{key:AgelCloud.client().storageKey,oldValue:JSON.stringify({user:AgelCloud.client().user,access_token:'old'}),newValue:JSON.stringify({user:AgelCloud.client().user,access_token:'refreshed'})}))")
  assert link.input_value()==url,'A same-account token refresh ended the source session'
  assert page.get_by_role('img',name='Código QR del showroom temporal').count()==1
  page.screenshot(path='/tmp/agel-share-host.png')
  phone=guest.new_page();phone.on('console',lambda msg:print('BROWSER',msg.type,msg.text,flush=True) if msg.type=='error' else None);phone.on('pageerror',lambda e:print('PAGE ERROR',e,flush=True));phone.goto(url)
  assert phone.locator('#share-login').count()==0,'QR presentation must not ask for an account'
  phone.locator('.ax-opening video').wait_for(timeout=20000)
  try:phone.wait_for_function("(()=>{const v=document.querySelector('.ax-opening video');return v&&v.readyState>=2&&v.videoWidth>0&&v.videoHeight===16;})()",timeout=20000)
  except Exception:
   print(phone.evaluate("(()=>{const v=document.querySelector('video');return {video:v&&{src:v.src,ready:v.readyState,network:v.networkState,error:v.error&&v.error.message},status:document.getElementById('share-status').textContent,bytes:window.__bytes,resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/media/')).map(r=>[r.name,r.duration,r.transferSize])};})()"),flush=True);raise
  video_url=phone.locator('.ax-opening video').get_attribute('src');assert '/apps/share/media/' in video_url
  result=phone.evaluate('''async url=>{const r=await fetch(url,{headers:{Range:'bytes=100-199'}});return {status:r.status,range:r.headers.get('Content-Range'),size:(await r.arrayBuffer()).byteLength};}''',video_url)
  assert result['status']==206 and result['size']==100 and result['range'].startswith('bytes 100-199/')
  assert phone.evaluate('window.__idbWrites')==0
  cdp=guest.new_cdp_session(phone);cdp.send('ServiceWorker.enable');cdp.send('ServiceWorker.stopAllWorkers')
  restarted=phone.evaluate('''async url=>{const r=await fetch(url,{headers:{Range:'bytes=100-199'}});return {status:r.status,size:(await r.arrayBuffer()).byteLength};}''',video_url)
  assert restarted=={'status':206,'size':100},'A normal worker restart must recover the live receiver'
  phone.get_by_role('button',name='Iniciar',exact=True).click();phone.get_by_role('img',name='Fachada',exact=True).wait_for()
  phone.get_by_role('button',name='Entrar al lobby',exact=True).click();phone.get_by_role('img',name='Lobby',exact=True).wait_for()
  assert phone.get_by_role('button',name='Modelo 3D local',exact=True).count()==0
  phone.get_by_text('Proyecto',exact=True).click()
  phone.get_by_role('button',name='Maqueta virtual',exact=True).click()
  phone.locator('.mq-count').filter(has_text='3 de 3 piezas').wait_for(state='attached',timeout=20000)
  try:phone.wait_for_function("(()=>{const v=document.querySelector('.ag-maquette video');return v&&v.srcObject instanceof MediaStream&&v.readyState>=2&&v.videoWidth>0;})()",timeout=15000)
  except Exception:
   for tab in (page,phone):print('RTC',tab.evaluate("async()=>{const v=document.querySelector('.ag-maquette video');return {captureError:window.__captureError,drawFrames:window.__drawFrames,drawSize:window.__drawSize,hidden:document.hidden,video:v&&{ready:v.readyState,width:v.videoWidth,error:v.error&&v.error.message,tracks:v.srcObject?.getTracks().map(t=>({kind:t.kind,state:t.readyState,muted:t.muted}))},stats:await Promise.all(__pcs.map(async pc=>({state:pc.connectionState,senders:pc.getSenders().map(s=>s.track&&({kind:s.track.kind,state:s.track.readyState,muted:s.track.muted})),stats:Array.from((await pc.getStats()).values()).filter(s=>s.type==='outbound-rtp'||s.type==='inbound-rtp')})))};}"),flush=True)
   raise
  phone.get_by_role('button',name='Filtros',exact=True).click()
  phone.get_by_role('button',name='Instalaciones (1)',exact=True).click()
  phone.locator('.mq-count').filter(has_text='1 de 3 piezas').wait_for(timeout=5000)
  phone.get_by_label('Vista de maqueta',exact=True).select_option('top')
  assert phone.get_by_role('button',name='Iniciar AR',exact=False).count()==0
  assert page.evaluate('window.__sentGlb||0')==0,'Original GLB escaped through file transfer'
  assert phone.locator('.ag-maquette canvas').count()==0,'Receiver must decode a video, never parse geometry'
  phone.get_by_label('Vista de maqueta',exact=True).select_option('iso')
  phone.get_by_role('button',name='Filtros',exact=True).click()
  phone.wait_for_function("(()=>{const v=document.querySelector('.ag-maquette video'),c=document.createElement('canvas');c.width=720;c.height=480;const x=c.getContext('2d');x.drawImage(v,0,0,720,480);const p=x.getImageData(0,0,720,420).data;let blue=0;for(let i=0;i<p.length;i+=4)if(p[i+2]>80&&p[i+2]>p[i]*1.5)blue++;return blue>500;})()",timeout=10000)
  phone.screenshot(path='/tmp/agel-share-model.png')
  phone.get_by_role('button',name='Cerrar maqueta',exact=True).click()
  assert phone.evaluate("document.documentElement.scrollWidth<=innerWidth")
  phone.screenshot(path='/tmp/agel-share-receiver.png')
  # Bytes in the wire manifest are sanitized before the showroom boots.
  assert phone.locator('body').inner_text().find('DO_NOT_SHARE')<0
  assert phone.evaluate("JSON.parse(localStorage.getItem('fixtureWrites')||'[]')")==[]
  assert phone.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('agel.sel.')).length")==0
  page.get_by_role('button',name='Finalizar',exact=True).click()
  phone.locator('#share-gate').wait_for(state='visible',timeout=5000)
  assert phone.locator('.ax-shell').count()==0
  assert phone.evaluate('window.__idbWrites')==0
  assert phone.evaluate('window.__authCalls||0')==0
  assert backend_requests==[],'A QR visitor must not call Auth, project REST or Storage'
  assert phone.get_by_role('link',name='Editor',exact=True).count()==0
  assert phone.evaluate('async()=>await indexedDB.databases()')==[]
  assert phone.evaluate('async()=>await caches.keys()')==[]
  browser.close()
  print('PASS: local QR without login, real WebRTC, 80 MiB Opening ranges, facade/lobby, pixel-streamed 3D controls without original GLB, no receiver DB or writes, remote close')
finally:server.shutdown();server.server_close()
