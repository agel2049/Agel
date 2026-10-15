"""Local UI test harness: no user sessions, external services or production data."""
import functools,http.server,os,threading
from pathlib import Path
from contextlib import contextmanager
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
class QuietHandler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
@contextmanager
def local_page(route,viewport=None,setup=None):
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
 threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as p:
   path=os.environ.get('AGEL_BROWSER_EXECUTABLE') or ('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' if Path('/Applications/Google Chrome.app').exists() else None)
   browser=p.chromium.launch(executable_path=path,headless=True)
   page=browser.new_page(viewport=viewport or {'width':1200,'height':900})
   if setup:setup(page)
   page.goto(f'http://127.0.0.1:{server.server_port}/{route}')
   try:yield page
   finally:browser.close()
 finally:server.shutdown();server.server_close()
