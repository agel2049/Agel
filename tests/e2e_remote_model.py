import os
from pathlib import Path
from urllib.parse import urlparse
from ui_harness import local_page
from glb_fixture import glb_bytes
vendor=Path(os.environ.get('AGEL_THREE_VENDOR',str(Path(__file__).parent/'vendor/node_modules/three')))
def setup(pg):
 pg.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**',lambda r:r.fulfill(path=str(vendor/urlparse(r.request.url).path.split('three@0.128.0/')[1])))
with local_page('tests/fixtures/remote-model.html',setup=setup) as pg:
 pg.evaluate('window.useRTC=true')
 pg.evaluate('mountRemote',list(glb_bytes()))
 pg.wait_for_function("remoteStates.some(m=>m.state==='ready')")
 pg.wait_for_function("document.querySelector('video').readyState>=2")
 assert pg.evaluate('drawnFrames')>0,'Renderer did not composite a WebGL frame'
 assert pg.evaluate('typeof renderedViewer.orbit')=='function','Renderer remote orbit is unavailable'
 assert pg.evaluate("(()=>{const v=document.querySelector('video');return v.videoWidth>0&&v.videoWidth<=720&&Math.abs(v.videoWidth/v.videoHeight-1.5)<.02;})()"),'WebRTC must deliver the canvas aspect ratio; it may adapt resolution to CPU/network'
 assert pg.evaluate("async()=>Array.from((await senderPC.getStats()).values()).some(s=>s.type==='outbound-rtp'&&s.kind==='video'&&s.framesEncoded>0)"),'Canvas video was not encoded by WebRTC'
 pg.wait_for_timeout(200)
 watermark=pg.evaluate('''()=>{const c=document.createElement('canvas');c.width=720;c.height=480;const x=c.getContext('2d');x.drawImage(document.querySelector('video'),0,0,720,480);const p=x.getImageData(20,440,320,28).data;let light=0;for(let i=0;i<p.length;i+=4)if(p[i]>170&&p[i+1]>170&&p[i+2]>170)light++;return light;}''')
 assert watermark>200,'Session watermark text is missing from transmitted video pixels'
 video=pg.locator('video');before=pg.evaluate('videoPixels()')
 pg.get_by_label('Vista de maqueta',exact=True).select_option('top');pg.wait_for_timeout(200)
 assert before!=pg.evaluate('videoPixels()'),'Rendered camera view was not transmitted to video'
 before=pg.evaluate('videoPixels()');box=video.bounding_box();pg.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.45);pg.mouse.down();pg.mouse.move(box['x']+box['width']*.7,box['y']+box['height']*.6,steps=4);pg.mouse.up();pg.wait_for_timeout(200)
 assert before!=pg.evaluate('videoPixels()'),'Remote orbit did not change rendered video'
 video.focus();pg.keyboard.press('w');assert pg.evaluate("remoteCommands.at(-1).action")=='pan'
 # Mobile users can displace the camera with touch, and all manual gestures
 # consistently stop automatic rotation on the source and in the controls.
 desktop=pg;mobile_context=pg.context.browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
 pg=mobile_context.new_page();setup(pg);pg.goto(desktop.url);pg.evaluate('mountRemote',list(glb_bytes()));pg.wait_for_function("remoteStates.some(m=>m.state==='ready')&&document.querySelector('video').readyState>=2");video=pg.locator('video');pg.wait_for_timeout(100)
 spin=pg.get_by_role('button',name='Giro automático',exact=True)
 spin.click();assert spin.get_attribute('aria-pressed')=='true'
 assert pg.evaluate('renderedViewer.snapshot().spin') is True
 video.tap(position={'x':370,'y':310});assert spin.get_attribute('aria-pressed')=='false'
 assert pg.evaluate('renderedViewer.snapshot().spin') is False
 assert pg.evaluate("remoteCommands.at(-1).action==='spin'&&remoteCommands.at(-1).enabled===false")
 move=pg.get_by_role('button',name='Mover vista',exact=True);move.tap();assert move.get_attribute('aria-pressed')=='true'
 before_position=pg.evaluate('renderedViewer.snapshot().target');before=pg.evaluate('videoPixels()')
 box=video.bounding_box();x=box['x']+box['width']*.65;y=box['y']+box['height']*.4
 pg.evaluate('''({x,y})=>{const v=document.querySelector('video');v.dispatchEvent(new PointerEvent('pointerdown',{pointerId:8,pointerType:'touch',clientX:x,clientY:y,bubbles:true}));v.dispatchEvent(new PointerEvent('pointermove',{pointerId:8,pointerType:'touch',clientX:x+70,clientY:y+40,bubbles:true}));v.dispatchEvent(new PointerEvent('pointerup',{pointerId:8,pointerType:'touch',clientX:x+70,clientY:y+40,bubbles:true}));}''',{'x':x,'y':y});pg.wait_for_timeout(200)
 assert pg.evaluate("remoteCommands.at(-1).action")=='pan'
 assert before_position!=pg.evaluate('renderedViewer.snapshot().target'),'Touch pan did not displace the camera'
 assert before!=pg.evaluate('videoPixels()'),'Touch pan did not alter transmitted pixels'
 for control in [move,spin,pg.get_by_label('Vista de maqueta',exact=True),pg.get_by_label('Acercar maqueta',exact=True),pg.get_by_label('Alejar maqueta',exact=True)]:
  rect=control.bounding_box();assert rect['x']>=0 and rect['x']+rect['width']<=390 and rect['y']>=0 and rect['y']+rect['height']<=844,'Phone camera control escaped viewport'
 spin.tap();assert pg.evaluate('renderedViewer.snapshot().spin') is True
 video.focus();pg.keyboard.press('w');assert spin.get_attribute('aria-pressed')=='false'
 assert pg.evaluate('renderedViewer.snapshot().spin') is False
 assert pg.evaluate("remoteCommands.slice(-2)[0].action==='spin'&&remoteCommands.slice(-2)[0].enabled===false&&remoteCommands.at(-1).action==='pan'")
 pg.evaluate('remoteMount.dispose();remoteHost.close()');mobile_context.close();pg=desktop;video=pg.locator('video')
 pg.get_by_role('button',name='Instalaciones (1)',exact=True).click();pg.wait_for_timeout(200)
 assert pg.get_by_role('status').inner_text()=='1 de 3 piezas'
 assert not any(k in pg.evaluate('JSON.stringify(remoteStates)') for k in ['Tubería_01','geometry','secretid'])
 assert pg.get_by_role('button',name='Ver en mi espacio').count()==0
 pg.get_by_role('button',name='Cerrar maqueta',exact=True).click();assert pg.locator('video').count()==0
 assert pg.evaluate("remoteCommands.at(-1).action")=='pause';assert pg.evaluate("remoteHost.stream.getTracks().every(t=>t.readyState==='live')")
 pg.evaluate('remoteHost.close();senderPC.close();receiverPC.close()');assert pg.locator('#source canvas').count()==0;assert pg.evaluate("remoteHost.stream.getTracks().every(t=>t.readyState==='ended')")
 print('PASS: real WebGL pixels transmitted by canvas stream, views/orbit/pan/filter, no geometry metadata, pause and track/GPU cleanup')
