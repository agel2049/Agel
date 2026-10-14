#!/usr/bin/env python3
"""
AgelArq — pruebas de regresión en navegador real (Chromium + WebGL por software).

Uso:
    python3 tests/e2e.py index.html            # todas las pruebas
    python3 tests/e2e.py index.html -k visor   # solo las que contienen "visor"

Qué hace:
  * Sirve la app en un servidor local.
  * Sustituye los CDN (three r128, qrcodejs, tabler icons) por copias locales
    de las MISMAS versiones, instaladas con npm en tests/vendor.
  * Simula Supabase Storage en memoria. Reproduce las políticas reales del
    proyecto a 13-oct-2026: SELECT e INSERT públicos; UPDATE y DELETE sin
    política (denegados). Así las pruebas reflejan producción.
  * Ejecuta recorridos críticos del plan maestro (editar, hotspots, guardar,
    recargar, compartir, abrir enlace de cliente, modelos D5) y reporta.
"""
import functools, http.server, json, os, re, shutil, sys, threading, time, traceback
from pathlib import Path
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright

ROOT     = Path(__file__).resolve().parent
FIXTURES = ROOT / 'fixtures'
VENDOR   = ROOT / 'vendor' / 'node_modules'   # npm ci --prefix tests/vendor
SUPA     = 'ajvijnvmvniafevcrqfj.supabase.co'
BUCKET   = 'panoramas'

# ───────────────────────── servidor de la app ─────────────────────────
def serve(app_html: Path):
    site = Path(os.environ.get('AGEL_SITE', '/tmp/agel_site'))
    if site.exists(): shutil.rmtree(site)
    site.mkdir(parents=True)
    (site / 'index.html').write_bytes(app_html.read_bytes())
    # Módulos compartidos del repositorio (motor 360, cliente de datos, apps).
    repo = ROOT.parent
    for d in ('packages', 'apps'):
        if (repo / d).exists(): shutil.copytree(repo / d, site / d)
    for f in ('config.js',):
        if (repo / f).exists(): shutil.copy(repo / f, site / f)
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            # /slow/<segundos>/<fixture>: sirve una imagen con retraso, sin bloquear
            # al resto de peticiones (servidor con hilos). Para pruebas de carrera.
            m = re.match(r'^/slow/([\d.]+)/([\w.-]+)$', self.path)
            if not m: return super().do_GET()
            time.sleep(float(m.group(1)))
            data = (FIXTURES / m.group(2)).read_bytes()
            self.send_response(200)
            self.send_header('content-type', 'image/jpeg')
            self.send_header('access-control-allow-origin', '*')
            self.send_header('content-length', str(len(data)))
            self.end_headers(); self.wfile.write(data)
    handler = functools.partial(Quiet, directory=str(site))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{srv.server_address[1]}/', srv

# ───────────────────────── Supabase simulado ─────────────────────────
class SupaMock:
    def __init__(self):
        self.objects = {}        # path -> (bytes, content_type)
        self.requests = []       # (method, path, status)
        self.fail_uploads = False  # simula Supabase caído/sin cuota

    def put_fixture(self, path, fixture):
        ct = 'image/jpeg' if fixture.endswith('.jpg') else 'application/octet-stream'
        self.objects[path] = ((FIXTURES / fixture).read_bytes(), ct)

    def put_json(self, path, obj):
        raw = obj if isinstance(obj, (bytes, str)) else json.dumps(obj)
        self.objects[path] = (raw.encode() if isinstance(raw, str) else raw, 'application/json')

    def public_url(self, path):
        return f'https://{SUPA}/storage/v1/object/public/{BUCKET}/{path}'

    def handle(self, route, request):
        u = urlparse(request.url)
        p = unquote(u.path)
        cors = {'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
                'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS'}
        def reply(status, body=b'', ct='application/json'):
            self.requests.append((request.method, p, status))
            route.fulfill(status=status, headers={**cors, 'content-type': ct}, body=body)

        if request.method == 'OPTIONS':
            return reply(200)
        m = re.match(rf'/storage/v1/(?:object/public|render/image/public)/{BUCKET}/(.+)', p)
        if m and request.method == 'GET':
            obj = self.objects.get(m.group(1))
            if not obj: return reply(400, b'{"error":"not_found"}')
            return reply(200, obj[0], obj[1])
        if p.startswith('/rest/v1/'):
            return reply(404, b'{"code":"PGRST202","message":"Could not find the function"}')
        if p.startswith('/storage/v1/object/list/'):
            return reply(200, b'[]')
        m = re.match(rf'/storage/v1/object/{BUCKET}/(.+)', p)
        if m and request.method == 'POST' and self.fail_uploads:
            return reply(402, b'{"error":"quota exceeded"}')
        if m and request.method == 'POST':
            path = m.group(1)
            if path in self.objects:  # upsert sobre existente => necesita UPDATE (no hay política)
                return reply(400, b'{"error":"new row violates row-level security policy"}')
            body = request.post_data_buffer or b''
            if not body:
                # Playwright no expone el cuerpo de un XHR.send(File). El nombre
                # remoto es "<timestamp>_<nombre original>", así que recuperamos
                # la fixture que el navegador realmente envió.
                fx = FIXTURES / re.sub(r'^\d+_', '', path.split('/')[-1])
                if fx.exists(): body = fx.read_bytes()
            self.objects[path] = (body, request.headers.get('content-type', 'application/octet-stream'))
            return reply(200, json.dumps({'Key': f'{BUCKET}/{path}'}).encode())
        if m and request.method == 'DELETE':
            # Sin política DELETE en producción: Storage responde "not found".
            return reply(400, b'{"statusCode":"404","error":"not_found","message":"Object not found"}')
        return reply(404, b'{}')

# ───────────────────────── contexto de navegador ─────────────────────────
VENDOR_MAP = {
    'three.js/r128/three.min.js': VENDOR / 'three/build/three.min.js',
    'qrcodejs/1.0.0/qrcode.min.js': VENDOR / 'qrcodejs/qrcode.min.js',
}

def wire(ctx, supa):
    def cdn(route, request):
        url = request.url
        for key, path in VENDOR_MAP.items():
            if url.endswith(key):
                return route.fulfill(path=str(path), headers={'access-control-allow-origin': '*'})
        m = re.search(r'@tabler/icons-webfont@[^/]+/(.+)$', urlparse(url).path)
        if m:
            f = VENDOR / '@tabler/icons-webfont' / m.group(1)
            if f.exists(): return route.fulfill(path=str(f))
        return route.abort()
    ctx.route(re.compile(r'https://(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)/.*'), cdn)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, q: r.abort())
    ctx.route(re.compile(r'https://tinyurl\.com/.*'), lambda r, q: r.abort())
    ctx.route(re.compile(rf'https://{re.escape(SUPA)}/.*'), supa.handle)

class Page:
    """Envoltura con utilidades y registro de errores JS."""
    def __init__(self, ctx, base):
        self.base, self.pg, self.errors, self.dialogs = base, ctx.new_page(), [], []
        self.pg.on('pageerror', lambda e: self.errors.append(str(e)))
        def on_dialog(d):
            self.dialogs.append(d.message); d.accept()
        self.pg.on('dialog', on_dialog)

    def open(self, query='', wait_intro=True):
        self.pg.goto(self.base + query, wait_until='load')
        if wait_intro:
            self.pg.wait_for_function("!document.getElementById('intro')", timeout=8000)
        return self

    def ev(self, js, arg=None):
        return self.pg.evaluate(js, arg) if arg is not None else self.pg.evaluate(js)

    def wait(self, js, timeout=6000):
        self.pg.wait_for_function(js, timeout=timeout)

    def upload_pano(self, fixture):
        self.pg.set_input_files('#fi', str(FIXTURES / fixture))

# ───────────────────────── pruebas ─────────────────────────
TESTS = []
def test(fn): TESTS.append(fn); return fn

def check(cond, msg):
    if not cond: raise AssertionError(msg)

def map_src(p, sphere='pano.sphere'):
    return p.ev(f"(() => {{ const m = {sphere}.material && {sphere}.material.map; "
                f"return m && m.image ? (m.image.currentSrc || m.image.src || (m.userData && m.userData.sourceUrl) || '[canvas]') : null; }})()")

@test
def arranque_sin_errores(ctx, base, supa):
    p = Page(ctx, base).open()
    check(p.ev("typeof THREE") == 'object', 'three.js no cargó')
    check(p.ev("!!pano && !!pano.renderer && !!pano.sphere"), 'el motor 360 no se inicializó')
    check(not p.errors, f'errores JS al arrancar: {p.errors}')

@test
def subir_panoramica_y_mostrarla(ctx, base, supa):
    p = Page(ctx, base).open()
    p.upload_pano('pano_a.jpg')
    p.wait("PROJ[cP].scenes[cS].supaUrl", 8000)
    p.wait("pano.sphere.material.map && pano.sphere.material.map.image", 8000)
    check('pano_a' in (map_src(p) or ''), f'la esfera no muestra la panorámica subida: {map_src(p)}')
    check(not p.errors, f'errores JS: {p.errors}')

def _prepare_two_scenes(p):
    p.upload_pano('pano_a.jpg'); p.wait("PROJ[cP].scenes[0].supaUrl", 8000)
    p.ev("selScene(1)")
    p.upload_pano('pano_b.jpg'); p.wait("PROJ[cP].scenes[1].supaUrl", 8000)
    p.ev("selScene(0)")
    p.wait("pano.sphere.material.map && /pano_a/.test(pano.sphere.material.map.image.src)", 8000)

@test
def subida_rapida_tras_elegir_escena_vacia(ctx, base, supa):
    # Antes: la llamada pendiente de "mostrar escena vacía" llegaba tarde y
    # dejaba la pantalla negra con la panorámica ya guardada.
    p = Page(ctx, base).open()
    p.upload_pano('pano_a.jpg'); p.wait("PROJ[cP].scenes[0].supaUrl", 8000)
    p.ev("selScene(1)"); p.upload_pano('pano_b.jpg')       # sin esperar
    p.wait("PROJ[cP].scenes[1].supaUrl", 8000); p.pg.wait_for_timeout(1500)
    check('pano_b' in (map_src(p) or ''), f'la panorámica subida no se muestra: {map_src(p)}')

@test
def iconos_cargan(ctx, base, supa):
    p = Page(ctx, base).open()
    p.pg.wait_for_timeout(500)
    fam = p.ev("getComputedStyle(document.querySelector('.ti'), '::before').fontFamily")
    check('tabler' in fam and p.ev("document.fonts.check('16px tabler-icons')"),
          f'la fuente de íconos no carga (botones vacíos): {fam}')

@test
def hotspot_info_con_detalles_multilinea(ctx, base, supa):
    p = Page(ctx, base).open(); _prepare_two_scenes(p)
    p.ev("toggleHSPanel(); hsmSetTab('add')")
    p.ev("""() => {
        document.getElementById('hsmTitle').value  = 'Piso';
        document.getElementById('hsmDetail').value = 'Mármol travertino 60×60, pulido espejo\\nJunta 3 mm';
        document.getElementById('hsmX').value = 40; document.getElementById('hsmY').value = 55;
        hsmSaveInfo(); }""")
    h = p.ev("PROJ[cP].scenes[0].hs.at(-1)")
    check(h['title'] == 'Piso', f'hotspot no guardado: {h}')
    check(h['details'] == ['Mármol travertino 60×60, pulido espejo', 'Junta 3 mm'],
          f'detalles partidos incorrectamente: {h["details"]}')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def editar_hotspot_de_escena_se_guarda(ctx, base, supa):
    p = Page(ctx, base).open(); _prepare_two_scenes(p)
    p.ev("toggleHSPanel(); hsmSetTab('add')")
    p.ev("""() => { document.getElementById('hsmSSScene').value = 0;
                    document.getElementById('hsmSSTarget').value = 1; hsmSaveSceneSpot(); }""")
    j = p.ev("PROJ[cP].scenes[0].hs.length - 1")
    check(p.ev(f"PROJ[cP].scenes[0].hs[{j}].type") == 'scene', 'no se creó el hotspot de escena')
    # Editar como lo haría un usuario: cambiar destino y posición, pulsar Actualizar.
    p.ev(f"hsmEditHS(0,{j})")
    p.ev("""() => { document.getElementById('hsmTargetScene').value = 2;
                    document.getElementById('hsmX').value = 77; }""")
    p.pg.click('.hsm-save')
    h = p.ev(f"PROJ[cP].scenes[0].hs[{j}]")
    check(h['type'] == 'scene' and h.get('targetScene') == 2 and h.get('x') == 77,
          f'la edición del hotspot de escena no se guardó: {h} · avisos: {p.ev("document.getElementById(\'toast\').textContent")!r}')

@test
def persistencia_tras_recargar(ctx, base, supa):
    p = Page(ctx, base).open(); _prepare_two_scenes(p)
    p.ev("PROJ[cP].scenes[0].name = 'Lobby verificado'; saveData();")
    p.open()
    check(p.ev("PROJ[cP].scenes[0].name") == 'Lobby verificado', 'el nombre de escena no persistió')
    check(p.ev("!!PROJ[cP].scenes[1].supaUrl"), 'la URL de la panorámica no persistió')

@test
def borrar_escena_y_deshacer(ctx, base, supa):
    p = Page(ctx, base).open(); _prepare_two_scenes(p)
    n = p.ev("PROJ[cP].scenes.length")
    p.ev("deleteScene(1)")
    check(p.ev("PROJ[cP].scenes.length") == n - 1, 'la escena no se borró')
    p.pg.click('#toast button')
    check(p.ev("PROJ[cP].scenes.length") == n, 'deshacer no restauró la escena')

@test
def config_visor_persiste_tras_recargar(ctx, base, supa):
    p = Page(ctx, base).open()
    p.ev("""() => { document.getElementById('vmProjName').value = 'Torre QA';
                    document.getElementById('vmOpeningTitle').value = 'Bienvenida QA';
                    saveVmData(); }""")
    p.open()
    name  = p.ev("document.getElementById('vmProjName').value")
    title = p.ev("document.getElementById('vmOpeningTitle').value")
    check(name == 'Torre QA' and title == 'Bienvenida QA',
          f'la configuración del visor no persistió: nombre={name!r} titulo={title!r}')
    check(not p.errors, f'errores JS: {p.errors}')

def _visor_cfg(supa, cfg_id, cfg):
    supa.put_fixture('a.jpg', 'pano_a.jpg'); supa.put_fixture('b.jpg', 'pano_b.jpg')
    supa.put_fixture('c.jpg', 'pano_c.jpg')
    supa.put_json(f'configs/{cfg_id}.json', cfg)

def _ok_cfg(supa):
    return {'v': 2, 'p': 'Torre QA', 'sub': 'Prueba', 'scenes': [
        {'name': 'Lobby', 'meta': 'PB', 'url': supa.public_url('a.jpg'),
         'hs': [{'type': 'scene', 'x': 50, 'y': 50, 'title': 'Terraza', 'targetScene': 1},
                {'type': 'info', 'x': 30, 'y': 50, 'title': 'Piso', 'details': ['Mármol']}]},
        {'name': 'Terraza', 'meta': 'N22', 'url': supa.public_url('b.jpg'), 'hs': []},
        {'name': 'Sótano', 'meta': 'S1', 'url': supa.public_url('c.jpg'), 'hs': []}]}

@test
def visor_por_enlace_carga_escenas(ctx, base, supa):
    _visor_cfg(supa, 'qa1', _ok_cfg(supa))
    p = Page(ctx, base).open('?visor=1&id=qa1')
    p.wait("vmPano && vmPano.sphere.material.map && /a\\.jpg/.test(vmPano.sphere.material.map.image.src)", 8000)
    check(p.ev("vmScenes.length") == 3, 'no se cargaron las 3 escenas')
    check(p.ev("document.querySelectorAll('#visorMode .hs').length") >= 2, 'no se dibujaron los hotspots')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def visor_arrastre_sobre_punto_no_navega(ctx, base, supa):
    _visor_cfg(supa, 'drag', _ok_cfg(supa))
    p = Page(ctx, base).open('?visor=1&id=drag')
    p.wait("vmPano && vmPano.sphere.material.map && /a\\.jpg/.test(vmPano.sphere.material.map.image.src)", 8000)
    p.ev("vmPano.setView(0, 0, 55)"); p.pg.wait_for_timeout(300)
    spot = p.pg.locator('#vmHsLayer .hs.scene-spot')
    b = spot.bounding_box()
    x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
    p.pg.mouse.move(x, y); p.pg.mouse.down(); p.pg.mouse.move(x + 120, y, steps=10); p.pg.mouse.move(x + 2, y, steps=10); p.pg.mouse.up()
    p.pg.wait_for_timeout(1200)
    check(p.ev("vmCurIdx") == 0, 'arrastrar sobre el punto de navegación cambió de escena')
    check(spot.get_attribute('role') == 'button' and spot.get_attribute('tabindex') == '0', 'el punto no es accesible con teclado')
    spot.focus(); p.pg.keyboard.press('Enter')
    p.wait("vmCurIdx === 1", 8000)
    check(not p.errors, f'errores JS: {p.errors}')

@test
def motor_unico_misma_sensibilidad(ctx, base, supa):
    # Antes: zoom con rueda al doble en el visor e inercia distinta al soltar.
    _visor_cfg(supa, 'sens', _ok_cfg(supa))
    p = Page(ctx, base).open()
    def drag(sel, engine):
        p.ev(f"{engine}.setView(0, 0, 55)")
        box = p.pg.locator(sel).bounding_box()
        cx, cy = box['x'] + box['width'] * 0.7, box['y'] + box['height'] * 0.3   # lejos de hotspots y paneles
        p.pg.mouse.move(cx, cy); p.pg.mouse.down(); p.pg.mouse.move(cx - 200, cy, steps=10); p.pg.mouse.up()
        p.ev(f"{engine}.stopInertia()")
        return p.ev(f"{engine}.lon")
    p.upload_pano('pano_a.jpg'); p.wait("pano.sphere.material.map", 8000)
    ed = drag('#panoCanvas', 'pano')
    p.open('?visor=1&id=sens'); p.wait("vmPano && vmPano.sphere.material.map", 8000)
    vm = drag('#vmCanvas', 'vmPano')
    check(abs(ed - 12) < 0.6 and abs(vm - ed) < 0.6, f'giro distinto: editor {ed:.2f}°, visor {vm:.2f}° (esperado ≈12°)')
    check(p.ev("typeof PanoEngine === 'undefined' && vmPano instanceof AgelPano.PanoEngine"), 'el visor no usa el motor compartido')
    box = p.pg.locator('#vmCanvas').bounding_box()
    p.ev("vmPano.fov = 55"); p.pg.mouse.move(box['x'] + box['width'] * 0.7, box['y'] + box['height'] * 0.3)
    p.pg.mouse.wheel(0, 100); p.pg.wait_for_timeout(300)
    check(abs(p.ev("vmPano.fov") - 60) < 0.01, f'zoom con rueda distinto al editor: FOV {p.ev("vmPano.fov")} (esperado 60)')

@test
def colocar_hotspot_con_clic(ctx, base, supa):
    p = Page(ctx, base).open()
    p.upload_pano('pano_a.jpg'); p.wait("pano.sphere.material.map", 8000)
    p.ev("toggleHSPanel(); hsmSetTab('add'); startAddHS()")
    box = p.pg.locator('#panoCanvas').bounding_box()
    p.pg.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    x, y = p.ev("[+document.getElementById('hsmX').value, +document.getElementById('hsmY').value]")
    check(abs(x - 50) <= 1 and abs(y - 50) <= 1, f'el clic al centro no dio (50, 50): ({x}, {y})')
    check(p.ev("pano.lon") == 0, 'colocar el hotspot giró la cámara')

@test
def visor_xss_en_config_no_ejecuta(ctx, base, supa):
    cfg = _ok_cfg(supa)
    payload = '<img src=x onerror="window.__pwned=1">'
    cfg['p'] = payload
    cfg['scenes'][0]['name'] = payload
    cfg['scenes'][0]['hs'][1]['title'] = payload
    cfg['scenes'][0]['hs'][1]['details'] = [payload]
    cfg['scenes'][0]['hs'][1]['img'] = 'javascript:window.__pwned=2'
    _visor_cfg(supa, 'xss', cfg)
    p = Page(ctx, base).open('?visor=1&id=xss')
    p.wait("vmScenes.length === 3", 8000)
    p.pg.wait_for_timeout(800)
    p.ev("document.querySelectorAll('#visorMode .hs:not(.scene-spot)').forEach(d => d.click())")
    p.ev("typeof vmTogglePanel === 'function' && vmTogglePanel()")
    p.pg.wait_for_timeout(500)
    check(p.ev("window.__pwned === undefined"), f'¡XSS ejecutado! __pwned={p.ev("window.__pwned")}')

@test
def visor_config_invalida_no_rompe(ctx, base, supa):
    supa.put_json('configs/roto.json', '{"v":2,"scenes":"no-es-lista"')   # JSON truncado
    supa.put_json('configs/raro.json', {'v': 2, 'p': 123, 'scenes': [{'name': {'x': 1}, 'url': 42, 'hs': 'x'}]})
    for cid in ('roto', 'raro', 'noexiste'):
        p = Page(ctx, base).open(f'?visor=1&id={cid}')
        p.pg.wait_for_timeout(700)
        check(not p.errors, f'config "{cid}" lanzó errores JS: {p.errors}')
        visible = p.ev("document.getElementById('visorMode').innerText")
        check(re.search(r'no disponible|no es válido|expirado', visible, re.I),
              f'config "{cid}" no mostró un mensaje de recuperación')

@test
def visor_respuesta_tardia_no_reemplaza_escena(ctx, base, supa):
    cfg = _ok_cfg(supa)
    cfg['scenes'][1]['url'] = base + 'slow/2.5/pano_b.jpg'     # la escena 1 tarda 2.5 s
    _visor_cfg(supa, 'race', cfg)
    p = Page(ctx, base).open('?visor=1&id=race')
    p.wait("vmPano.sphere.material.map && /a\\.jpg/.test(vmPano.sphere.material.map.image.src)", 8000)
    p.wait("!!vmTexCache[2]", 8000)                         # la rápida ya está en caché
    p.ev("vmGoTo(1)")                                       # pide la lenta…
    p.ev("vmGoTo(2)")                                       # …y el usuario cambia enseguida
    p.wait("vmPano.sphere.material.map && /pano_c|c\\.jpg/.test(vmPano.sphere.material.map.image.src)", 8000)
    p.pg.wait_for_timeout(3500)                             # llega la respuesta tardía
    src = p.ev("vmPano.sphere.material.map.image.src")
    check('c.jpg' in src and p.ev("vmCurIdx") == 2,
          f'la respuesta tardía reemplazó la escena actual: muestra {src}, índice {p.ev("vmCurIdx")}')

@test
def textura_mayor_al_limite_se_reduce(ctx, base, supa):
    p = Page(ctx, base).open()
    p.ev("pano.maxTexture = 4096")                     # simula un móvil de gama media
    p.upload_pano('pano_huge.jpg')
    p.wait("pano.sphere.material.map && pano.sphere.material.map.image", 15000)
    w = p.ev("(pano.sphere.material.map.image.width || 0)")
    check(w <= 4096, f'la textura se entregó a {w}px, por encima del límite de 4096px de la GPU')

@test
def respaldo_exportar_importar(ctx, base, supa):
    p = Page(ctx, base).open(); _prepare_two_scenes(p)
    check(p.ev("typeof exportBackup === 'function' && typeof importBackupData === 'function'"),
          'no existe exportar/importar respaldo')
    data = p.ev("buildBackup()")
    check(data.get('format') == 'agelarq-backup' and data.get('proj'), 'respaldo sin datos de proyectos')
    p.ev("PROJ[cP].scenes[0].name = 'CAMBIO LOCAL'; saveData()")
    p.ev("d => importBackupData(d, { confirm: false })", data)
    p.open()
    check(p.ev("PROJ[cP].scenes[0].name") != 'CAMBIO LOCAL', 'importar no restauró el proyecto')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def respaldo_recupera_imagen_solo_local(ctx, base, supa):
    supa.fail_uploads = True                         # Supabase sin cuota → guardado local
    p = Page(ctx, base).open()
    p.upload_pano('pano_c.jpg')
    p.wait("pano.sphere.material.map && pano.sphere.material.map.image", 8000)
    check(p.ev("!PROJ[cP].scenes[0].supaUrl"), 'la imagen no quedó solo en local')
    with p.pg.expect_download() as dl:
        p.ev("exportBackup()")
    path = dl.value.path()
    data = json.loads(Path(path).read_text())
    check(data['summary']['localImages'] >= 1, f'el respaldo no incluyó la imagen local: {data["summary"]}')
    # Borrado total del navegador (como cambiar de equipo)
    p.ev("""() => new Promise(r => { _idb && _idb.close(); _idb = null; localStorage.clear();
              const q = indexedDB.deleteDatabase('agelarq_images'); q.onsuccess = q.onerror = q.onblocked = () => r(); })""")
    p.open()
    check(p.ev("!(pano.sphere.material && pano.sphere.material.map)"), 'tras borrar, la imagen no debería existir')
    p.pg.set_input_files('.sb-backup input[type=file]', path)
    p.pg.wait_for_load_state('load'); p.pg.wait_for_timeout(1500)
    p.wait("!document.getElementById('intro')", 8000)
    p.wait("pano.sphere.material && pano.sphere.material.map && pano.sphere.material.map.image", 8000)
    check(not p.errors, f'errores JS: {p.errors}')

@test
def modelo_d5_url_peligrosa_bloqueada(ctx, base, supa):
    supa.put_json('configs/d5/qa.json', {'p': 'Modelo QA', 'models': [
        {'name': 'M1', 'url': 'javascript:window.parent.__pwned=3'}]})
    p = Page(ctx, base).open('?modelo=1&id=qa')
    p.pg.wait_for_timeout(1500)
    check(p.ev("window.__pwned === undefined"), 'URL javascript: ejecutada en el iframe D5')
    check(re.search(r'no es válido|no disponible', p.ev("document.getElementById('d5Mode').innerText"), re.I),
          'un enlace D5 sin modelos válidos no mostró aviso')

MODEL_PROBE = """<!doctype html><canvas id=c></canvas><script>
let gl = false; try { gl = !!document.getElementById('c').getContext('webgl'); } catch(e) {}
let escaped = null;
try { escaped = window.parent.document.title; window.parent.__escaped = 1; } catch(e) {}
let storage = null; try { storage = Object.keys(window.parent.localStorage).length; } catch(e) {}
parent.postMessage({probe: 1, gl, escaped, storage}, '*');
</script>"""

@test
def modelo_d5_local_aislado_pero_funcional(ctx, base, supa):
    p = Page(ctx, base).open()
    p.ev("window.__probe = null; addEventListener('message', e => { if (e.data && e.data.probe) window.__probe = e.data; })")
    p.ev("""html => { const url = URL.createObjectURL(new Blob([html], {type: 'text/html'}));
                      d5Models = [{ name: 'Local', meta: '', url, isLocal: true }]; d5LaunchViewer(); }""", MODEL_PROBE)
    p.wait("window.__probe !== null", 8000)
    r = p.ev("window.__probe")
    check(r['gl'] is True, f'el modelo aislado perdió WebGL: {r}')
    check(r['escaped'] is None and r['storage'] is None and p.ev("window.__escaped === undefined"),
          f'el modelo local alcanzó la app (DOM/localStorage del editor): {r}')

# ───────────────────────── ejecución ─────────────────────────
def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(2)
    app = Path(args[0]).resolve()
    only = args[args.index('-k') + 1] if '-k' in args else None
    base, srv = serve(app)
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        for fn in TESTS:
            if only and only not in fn.__name__: continue
            supa = SupaMock()
            ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
            # Esta suite prueba el modo local (sin cuenta), como quien elige
            # «Seguir sin cuenta». El modo nube tiene su propia suite.
            ctx.add_init_script("try { if (!localStorage.getItem('agel.mode')) localStorage.setItem('agel.mode', 'local'); } catch (e) {}")
            wire(ctx, supa)
            t0 = time.time()
            try:
                fn(ctx, base, supa); status, info = 'PASS', ''
            except AssertionError as e:
                status, info = 'FAIL', str(e)
            except Exception as e:
                status, info = 'ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:200]}'
            ctx.close()
            results.append((fn.__name__, status, info))
            print(f'{status:5}  {fn.__name__:46} {time.time()-t0:4.1f}s  {info[:160]}', flush=True)
        browser.close()
    srv.shutdown()
    ok = sum(r[1] == 'PASS' for r in results)
    print(f'\n{ok}/{len(results)} pruebas superadas')
    sys.exit(0 if ok == len(results) else 1)

if __name__ == '__main__':
    main()
