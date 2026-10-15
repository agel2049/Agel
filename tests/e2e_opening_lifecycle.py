import sys
from ui_harness import local_page

def setup(pg):
 pg.wait_for_function('window.vmFixtureReady')
 pg.evaluate("async()=>{await vmHandleVideo('opening',{target:{files:[new File(['video'],'local.webm',{type:'video/webm'})],value:''}});vmScenes=[{name:'Sala',url:'https://example.test/pano.jpg'}];vmLaunch();}")

def reopen():
 with local_page('tests/fixtures/vm-local-videos.html') as pg:
  setup(pg)
  pg.evaluate('vmStartFromOpening()');pg.wait_for_timeout(900)
  pg.evaluate('vmLaunch()')
  assert pg.locator('#vmOpening').evaluate("e=>e.classList.contains('show')&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0'")
  pg.evaluate('vmStartFromOpening();vmLaunch()');pg.wait_for_timeout(900)
  assert pg.locator('#vmOpening').evaluate("e=>e.classList.contains('show')&&getComputedStyle(e).display!=='none'")
  assert not pg.locator('#vmViewer').evaluate("e=>e.classList.contains('show')")

def account():
 with local_page('tests/fixtures/vm-local-videos.html') as pg:
  setup(pg)
  pg.evaluate("async()=>{owner='owner-b';await vmLoadLocalVideos();}")
  assert not pg.locator('#vmOpeningVideo').get_attribute('src')
  assert pg.locator('#vmOpeningVideo').evaluate('e=>e.paused')
  assert not pg.locator('#vmOpening').evaluate("e=>e.classList.contains('show')")
  pg.evaluate("async()=>{owner='owner-a';await vmLoadLocalVideos();vmLaunch();await vmRemoveVideo('opening');}")
  assert not pg.locator('#vmOpeningVideo').get_attribute('src')

for name,fn in [('reopen',reopen),('account',account)]:
 if len(sys.argv)==1 or sys.argv[-1]==name:
  fn();print('PASS: Opening lifecycle '+name)
