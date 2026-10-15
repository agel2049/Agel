#!/usr/bin/env python3
"""
AgelArq — pruebas de extremo a extremo del panel y del visor BIM (fases 3 a 6).

Todo es real salvo Autodesk:
  navegador → mini-Supabase (Postgres + PostgREST con las migraciones)
            → funciones de servidor reales (Deno, supabase/functions)
            → Autodesk SIMULADO (servidor local con la misma API) y un visor
              simulado (tests/fixtures/fake-aps-viewer.js).
Uso:  python3 tests/e2e_bim.py [-k filtro] [--shots DIR]
"""
import http.server, json, os, re, shutil, socket, subprocess, sys, threading, time, uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import sync_playwright
from e2e import serve, Page, check, FIXTURES
from e2e_cloud import wire_cloud, HOST, PASSWORD
from minisupa import MiniSupa, jwt_sign, free_port

REPO = Path(__file__).resolve().parent.parent
DENO = os.environ.get('DENO') or shutil.which('deno') or '/home/claude/infra/node_modules/.bin/deno'
S3 = 'https://s3.agel-pruebas.mx'
TESTS = []
def test(fn): TESTS.append(fn); return fn
SHOTS = Path(sys.argv[sys.argv.index('--shots') + 1]) if '--shots' in sys.argv else None


# ───────────────────── Autodesk simulado ─────────────────────
class FakeAps:
    def __init__(self):
        self.calls, self.jobs, self.manifest_calls = [], {}, {}
        self.buckets = set()
        fake = self
        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def _reply(self, status, obj):
                b = json.dumps(obj).encode()
                self.send_response(status); self.send_header('content-type', 'application/json')
                self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
            def _body(self):
                n = int(self.headers.get('content-length') or 0); return self.rfile.read(n) if n else b''
            def do_POST(self): fake.handle(self, 'POST')
            def do_GET(self): fake.handle(self, 'GET')
        self.port = free_port()
        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', self.port), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.port}'

    def handle(self, h, method):
        u = urlparse(h.path); body = h._body()
        self.calls.append((method, u.path, h.headers.get('authorization', '')))
        if u.path == '/authentication/v2/token':
            if h.headers.get('authorization') != 'Basic ' + __import__('base64').b64encode(b'cliente-prueba:secreto-prueba').decode():
                return h._reply(401, {'developerMessage': 'bad client'})
            scope = parse_qs(body.decode()).get('scope', [''])[0]
            return h._reply(200, {'access_token': 'aps:' + scope, 'token_type': 'Bearer', 'expires_in': 3599})
        if not h.headers.get('authorization', '').startswith('Bearer aps:'):
            return h._reply(401, {'reason': 'sin token'})
        if u.path == '/oss/v2/buckets' and method == 'POST':
            key = json.loads(body)['bucketKey']
            if key in self.buckets: return h._reply(409, {'reason': 'exists'})
            self.buckets.add(key); return h._reply(200, {'bucketKey': key})
        m = re.match(r'^/oss/v2/buckets/([^/]+)/objects/(.+)/signeds3upload$', u.path)
        if m and method == 'GET':
            q = parse_qs(u.query); n = int(q['parts'][0]); first = int(q['firstPart'][0])
            return h._reply(200, {'uploadKey': q.get('uploadKey', ['UK-1'])[0], 'urls': [f'{S3}/part/{first + i}' for i in range(n)]})
        if m and method == 'POST':
            return h._reply(200, {'bucketKey': m.group(1), 'objectId': f'urn:adsk.objects:os.object:{m.group(1)}/{m.group(2)}', 'size': 1})
        if u.path == '/modelderivative/v2/designdata/job':
            d = json.loads(body); self.jobs[d['input']['urn']] = d; return h._reply(200, {'result': 'created'})
        m = re.match(r'^/modelderivative/v2/designdata/([^/]+)/manifest$', u.path)
        if m:
            urn = m.group(1)
            if urn not in self.jobs: return h._reply(404, {})
            n = self.manifest_calls[urn] = self.manifest_calls.get(urn, 0) + 1
            return h._reply(200, {'status': 'inprogress', 'progress': '50% complete'} if n == 1 else {'status': 'success', 'progress': 'complete', 'derivatives': []})
        h._reply(404, {'reason': 'no simulado ' + u.path})


class World:
    def __init__(self, browser, base, sb, aps):
        self.browser, self.base, self.sb, self.aps = browser, base, sb, aps
        self.ctxs, self.parts = [], []

    def page(self, email=None, width=1360, height=860):
        ctx = self.browser.new_context(viewport={'width': width, 'height': height}, accept_downloads=True)
        wire_cloud(ctx, self.sb)
        ctx.route(re.compile(r'https://developer\.api\.autodesk\.com/modelderivative/v2/viewers/.*\.js'),
                  lambda r, q: r.fulfill(path=str(FIXTURES / 'fake-aps-viewer.js'), headers={'content-type': 'text/javascript'}))
        ctx.route(re.compile(r'https://developer\.api\.autodesk\.com/modelderivative/v2/viewers/.*\.css'), lambda r, q: r.fulfill(body='', headers={'content-type': 'text/css'}))
        def s3(route, request):
            self.parts.append((request.method, request.url))
            route.fulfill(status=200, body='', headers={'access-control-allow-origin': '*', 'etag': '"x"'})
        ctx.route(re.compile(re.escape(S3) + r'/.*'), s3)
        ctx.route(re.compile(r'https://img\.agel-pruebas\.mx/.*'), lambda r, q: r.fulfill(
            path=str(FIXTURES / q.url.split('?')[0].rsplit('/', 1)[-1]), headers={'access-control-allow-origin': '*', 'content-type': 'image/jpeg'}))
        self.ctxs.append(ctx)
        p = Page(ctx, self.base)
        if email:
            p.pg.goto(self.base + 'apps/panel/robots.txt')          # mismo origen para guardar la sesión
            p.ev("s => localStorage.setItem('agel.session', s)", json.dumps(self.sb._issue(self.sb.users[email.lower()])))
        return p

    def user(self, name):
        email = f'{name}-{uuid.uuid4().hex[:6]}@prueba.mx'
        uid = self.sb.create_user(email, PASSWORD)
        return email, uid

    def as_user(self, uid, sql, params=None):
        return self.sb._as({'sub': uid, 'role': 'authenticated'}, sql, params)

    def val(self, uid, sql, params=None):
        v = self.as_user(uid, sql, params)[0][0]
        return str(v) if isinstance(v, uuid.UUID) else v

    def close(self):
        for c in self.ctxs:
            try: c.unroute_all(behavior='ignoreErrors')
            except Exception: pass
            try: c.close()
            except Exception: pass


def setup_project(w, name='Torre Coordinada'):
    email, uid = w.user('duena')
    org = w.val(uid, 'select public.create_organization(%s)', ('Estudio BIM',))
    p = w.val(uid, "select public.create_project(%s, %s, 'edificio')", (org, name))
    sid = str(uuid.uuid4())
    tree = {'project': {'name': name}, 'scenes': [{'id': sid, 'name': 'Cuarto de máquinas', 'pano_url': 'https://img.agel-pruebas.mx/pano_a.jpg', 'hs': []}]}
    w.val(uid, 'select public.save_project_tree(%s, %s, %s)', (p, json.dumps(tree), 0))
    return {'email': email, 'uid': uid, 'org': org, 'project': p, 'scene': sid, 'name': name}

def ready_version(w, d):
    """Modelo con una versión ya convertida (como si Autodesk hubiera terminado)."""
    m = w.val(d['uid'], "insert into public.models (project_id, name) values (%s, 'Modelo MEP') returning id", (d['project'],))
    v = w.as_user(d['uid'], "select public.create_model_version(%s, 'coordinación', 'torre.nwd', 1000)", (m,))[0][0]['id']
    w.sb.sql("update public.model_versions set status = 'ready', aps_urn = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6Yi9r', aps_bucket = 'b', aps_object_key = 'k' where id = %s", (v,))
    return str(m), str(v)

def modal_btn(p, name):
    return p.pg.locator('.ag-modal-actions').get_by_role('button', name=name, exact=True)

def shot(p, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True); p.pg.screenshot(path=str(SHOTS / f'{name}.png'))


# ───────────────────────── pruebas ─────────────────────────
def sync_panel(p):
    p.pg.get_by_role('button',name='Subir a la nube',exact=True).click()
    p.pg.get_by_role('button',name='Confirmar subida',exact=True).click()
    p.pg.wait_for_selector('text=Contenido sincronizado',timeout=10000)

@test
def panel_sube_y_convierte_modelo(w):
    d = setup_project(w)
    p = w.page(d['email'])
    p.pg.goto(w.base + f'apps/panel/#/p/{d["project"]}/modelos')
    p.pg.get_by_role('button', name='Nuevo modelo').click()
    p.pg.locator('.ag-modal input[type=text]').fill('Coordinación MEP')
    modal_btn(p, 'Crear').click()
    p.pg.wait_for_selector('h2:has-text("Coordinación MEP")')
    nwd = Path(os.environ.get('AGEL_SITE', '/tmp/agel_site')) / 'torre.nwd'
    nwd.write_bytes(os.urandom(300_000))
    p.pg.get_by_role('button', name='Subir versión').click()
    p.pg.set_input_files('.ag-modal input[type=file]', str(nwd))
    p.pg.locator('.ag-modal input[type=text]').fill('Semana 12')
    modal_btn(p, 'Subir y convertir').click()
    p.pg.wait_for_selector('.ag-pill:has-text("Convirtiendo")', timeout=15000)
    check(any(m == 'PUT' for m, _ in w.parts), 'el archivo no se subió a las URLs firmadas')
    row = w.sb.sql("select status, aps_urn, aps_object_key from public.model_versions mv join public.models m on m.id = mv.model_id where m.project_id = %s", (d['project'],))[0]
    check(row[0] == 'translating' and row[1] and row[2].endswith('/v1/torre.nwd'), f'versión: {row}')
    job = list(w.aps.jobs.values())[0]
    check(job['output']['formats'][0]['type'] == 'svf2', f'conversión pedida: {job}')
    p.pg.get_by_role('button', name='Actualizar estado').click()
    p.pg.wait_for_selector('.ag-pill:has-text("Convirtiendo 50%")', timeout=8000)
    p.pg.get_by_role('button', name='Actualizar estado').click()
    p.pg.wait_for_selector('a:has-text("Abrir visor")', timeout=8000)
    check(w.sb.sql("select status from public.model_versions where aps_urn = %s", (row[1],))[0][0] == 'ready', 'no quedó lista')
    check(not any('secreto-prueba' in json.dumps(x) for x in p.ev("performance.getEntriesByType('resource').map(e => e.name)")), 'secreto expuesto')
    shot(p, 'panel-modelos')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def visor_bim_indexa_filtra_y_4d(w):
    d = setup_project(w)
    m, v = ready_version(w, d)
    p = w.page(d['email'])
    p.pg.goto(w.base + f'apps/bim/?v={v}')
    p.pg.wait_for_selector('.fake-viewer button', timeout=10000)
    check(p.ev('__fake.token') == 'aps:data:read:urn:adsk.objects:os.object:b/k', f'token del visor: {p.ev("__fake.token")}')
    check(p.ev('__fake.urn') == 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6Yi9r', 'abrió otra URN')
    p.pg.get_by_role('button', name='Indexar ahora').click()
    p.pg.wait_for_selector('text=Indexación terminada', timeout=10000)
    txt = p.pg.inner_text('.ag-modal')
    check('20 elementos. 1 sin clasificar' in txt, f'resumen: {txt[:200]}')
    modal_btn(p, 'Cerrar').click()
    rows = dict(w.sb.sql("select discipline, count(*) from public.element_mappings where model_version_id = %s group by 1", (v,)))
    check(rows.get('Mecánica (HVAC)') == 4 and rows.get('Protección contra incendio') == 3 and rows.get('') == 1, f'clasificación: {rows}')
    # filtros
    p.pg.locator('.bm-facet button', has_text='Mecánica (HVAC)').click()
    p.wait("__fake.isolated && __fake.isolated.length === 4", 6000)
    check(sorted(p.ev('__fake.isolated')) == [1, 6, 11, 16], f'aisló {p.ev("__fake.isolated")}')
    p.pg.get_by_role('button', name='Ver todo').click()
    p.wait("__fake.isolated === null", 4000)
    p.pg.get_by_role('button',name='MEP',exact=True).click()
    p.wait("__fake.isolated && __fake.isolated.length === 15",6000)
    p.pg.get_by_role('button',name='Completo',exact=True).click()
    p.wait("__fake.isolated === null",4000)
    p.pg.get_by_role('button',name='Con acabados',exact=True).click()
    p.pg.wait_for_selector('text=Configura los elementos de esta vista')
    # propiedades
    p.pg.locator('.fake-viewer button[data-dbid="2"]').click()
    p.pg.wait_for_selector('#bm-panel h2:has-text("Pipes 2")')
    check('Hidrosanitaria' in p.pg.inner_text('#bm-panel'), 'no muestra la clasificación del elemento')
    # regla para el elemento sin clasificar y reindexado
    w.as_user(d['uid'], "insert into public.classification_rules (project_id, field, property, operator, value, set_value) values (%s, 'discipline', 'Layer', 'starts_with', 'E-', 'Eléctrica')", (d['project'],))
    p.pg.get_by_role('tab', name='Datos').click()
    p.pg.get_by_role('button', name='Reindexar').click()
    p.pg.wait_for_selector('text=Indexación terminada', timeout=10000)
    modal_btn(p, 'Cerrar').click()
    check(w.sb.sql("select discipline, classification from public.element_mappings where model_version_id = %s and source_id = 'ext-20'", (v,))[0] == ('Eléctrica', 'regla'), 'la regla no se aplicó')
    # 4D: tarea por nivel (vínculos automáticos) y reproducción
    tasks = [{'external_id': '1', 'name': 'Instalaciones N1', 'task_type': 'construir', 'planned_start': '2026-01-01', 'planned_end': '2026-01-31', 'attached': 'Level 1'},
             {'external_id': '2', 'name': 'Instalaciones N2', 'task_type': 'construir', 'planned_start': '2026-02-01', 'planned_end': '2026-02-28', 'attached': 'Level 2'}]
    w.as_user(d['uid'], 'select public.import_schedule(%s, %s, %s, true)', (d['project'], m, json.dumps(tasks)))
    w.as_user(d['uid'], 'select public.set_task_links(%s, %s, %s, true)', (d['project'], m, json.dumps(
        [{'external_id': '1', 'source_ids': [f'ext-{i}' for i in range(1, 11)]}, {'external_id': '2', 'source_ids': [f'ext-{i}' for i in range(11, 21)]}])))
    p.pg.get_by_role('tab', name='4D').click()
    p.pg.wait_for_selector('input[type=range]')
    p.ev("(() => { const s = document.querySelector('#bm-panel input[type=range]'); s.value = 15; s.dispatchEvent(new Event('input')); })()")
    p.wait("__fake.hidden.size === 10", 4000)
    check(sorted(p.ev('[...__fake.hidden]')) == list(range(11, 21)), 'en enero el nivel 2 debía estar oculto')
    check(len(p.ev('Object.keys(__fake.colors)')) == 10, 'el nivel 1 debía verse en construcción')
    p.ev("(() => { const s = document.querySelector('#bm-panel input[type=range]'); s.value = s.max; s.dispatchEvent(new Event('input')); })()")
    p.wait("__fake.hidden.size === 0 && Object.keys(__fake.colors).length === 10", 4000)
    shot(p, 'visor-bim-4d')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def vistas_incidencias_y_360(w):
    d = setup_project(w)
    m, v = ready_version(w, d)
    rev_email, rev = w.user('revisor')
    w.as_user(d['uid'], 'select public.add_project_member(%s, %s, %s)', (d['project'], rev_email, 'reviewer'))
    p = w.page(rev_email)
    p.pg.goto(w.base + f'apps/bim/?v={v}')
    p.pg.wait_for_selector('.fake-viewer button', timeout=10000)
    check(p.pg.get_by_role('button', name='Indexar ahora').count() == 0, 'un revisor puede indexar')
    p.pg.locator('.fake-viewer button[data-dbid="3"]').click()
    p.pg.get_by_role('tab', name='Incidencias').click()
    p.pg.get_by_role('button', name='Nueva').click()
    p.pg.locator('.ag-modal input[type=text]').fill('Choque de charola con ducto')
    modal_btn(p, 'Crear').click()
    p.pg.wait_for_selector('.bm-item:has-text("Choque de charola")', timeout=8000)
    row = w.sb.sql("select element_source_ids, viewpoint_id, created_by from public.issues where project_id = %s", (d['project'],))[0]
    check(row[0] == ['ext-3'] and row[1] and str(row[2]) == rev, f'incidencia: {row}')
    p.pg.get_by_role('tab', name='Vistas y 360°').click()
    p.pg.get_by_role('button', name='Guardar vista actual').click()
    p.pg.locator('.ag-modal input[type=text]').fill('Cuarto de bombas')
    p.pg.locator('.ag-modal select').select_option(label='Cuarto de máquinas')
    modal_btn(p, 'Guardar').click()
    p.pg.wait_for_selector('.bm-item:has-text("Cuarto de bombas")', timeout=8000)
    p.pg.locator('.bm-list li', has_text='Cuarto de bombas').get_by_role('button', name='Cuarto de máquinas').click()
    frame = p.pg.frame_locator('iframe.bm-pano')
    frame.locator('#m[hidden]').wait_for(state='attached', timeout=10000)
    # abrir por enlace directo restaura la vista y selecciona sus elementos
    vp = w.sb.sql("select id from public.viewpoints where name = 'Cuarto de bombas'")[0][0]
    p.pg.goto(w.base + f'apps/bim/?v={v}&vp={vp}')
    p.wait("window.__fake && __fake.restored && __fake.selection.length === 1", 10000)
    check(not p.errors, f'errores JS: {p.errors}')

@test
def accesos_del_visor(w):
    aps_calls_before = len(w.aps.calls)
    d = setup_project(w)
    m, v = ready_version(w, d)
    other, _ = w.user('ajeno'); setup_project(w)          # otra organización
    p = w.page(other)
    p.pg.goto(w.base + f'apps/bim/?v={v}')
    p.pg.wait_for_selector('text=Sin acceso', timeout=8000)
    q = w.page()
    q.pg.goto(w.base + f'apps/bim/?v={v}')
    q.pg.wait_for_selector('text=Inicia sesión', timeout=8000)
    w.sb.sql("update public.model_versions set status = 'translating' where id = %s", (v,))
    r = w.page(d['email'])
    r.pg.goto(w.base + f'apps/bim/?v={v}')
    r.pg.wait_for_selector('text=El modelo aún no está listo', timeout=8000)
    check(not any('authentication/v2/token' in c[1] for c in w.aps.calls[aps_calls_before:]), 'pidió token sin modelo listo')

@test
def panel_showroom_catalogo_y_publicacion(w):
    d = setup_project(w, 'Residencial Pinos')
    p = w.page(d['email'])
    p.pg.goto(w.base + f'apps/panel/#/p/{d["project"]}/showroom')
    p.pg.wait_for_selector('legend:has-text("Presentación")', timeout=8000)
    p.pg.get_by_label('Frase principal').fill('Casas entre pinos, a 10 minutos de Morelia')
    p.pg.get_by_label('Puntos destacados').fill('Terreno de 300 m²\nPaneles solares')
    p.pg.get_by_label('Correo para avisos de prospectos').fill('ventas@pinos.mx')
    p.pg.get_by_label('Webhook de CRM').fill('http://inseguro.example/hook')
    p.pg.locator('.pn-form').get_by_role('button', name='Guardar en este dispositivo', exact=True).click()
    p.pg.wait_for_selector('.ag-error:has-text("https://")')
    p.pg.get_by_label('Webhook de CRM').fill('')
    p.pg.locator('.pn-form').get_by_role('button', name='Guardar en este dispositivo', exact=True).click()
    p.pg.wait_for_selector('text=Guardado en este dispositivo.', timeout=6000)
    sync_panel(p)
    sr = w.sb.sql('select showroom from public.projects where id = %s', (d['project'],))[0][0]
    check(sr['tagline'].startswith('Casas entre pinos') and sr['highlights'] == ['Terreno de 300 m²', 'Paneles solares'], f'showroom: {sr}')
    # catálogo
    p.pg.get_by_role('link', name='Catálogo').click()
    p.pg.get_by_role('button', name='Nuevo espacio').click()
    p.pg.get_by_label('Nombre', exact=True).fill('Casa 7'); p.pg.get_by_label('Clave', exact=True).fill('C-07')
    p.pg.get_by_label('Precio', exact=True).fill('3950000'); p.pg.get_by_label('Estado', exact=True).select_option('disponible')
    p.pg.get_by_label('Mostrar precio al público').check()
    p.pg.get_by_label('Cuarto de máquinas').check()
    modal_btn(p, 'Guardar').click()
    p.pg.wait_for_selector('.pn-table th:has-text("Casa 7")', timeout=6000)
    sync_panel(p)
    # publicación
    p.pg.get_by_role('link', name='Publicaciones').click()
    p.pg.get_by_role('button', name='Nueva publicación').click()
    slug = 'pinos-' + uuid.uuid4().hex[:5]
    p.pg.get_by_label('Dirección').fill(slug)
    modal_btn(p, 'Crear').click()
    p.pg.get_by_role('button', name='Crear versión con el contenido actual').click()
    p.pg.wait_for_selector('text=Revisión antes de crear la versión', timeout=6000)
    modal_btn(p, 'Crear versión de todos modos').click()
    p.pg.wait_for_selector('button:has-text("Publicar")', timeout=6000)
    p.pg.get_by_role('button', name='Publicar', exact=True).click()
    p.pg.wait_for_selector('.ag-pill.ok:has-text("Publicada")', timeout=6000)
    shot(p, 'panel-publicaciones')
    q = w.page()
    q.pg.goto(w.base + f'apps/showroom/?p={slug}')
    q.pg.wait_for_selector('text=Casas entre pinos', timeout=8000)
    check('$3,950,000' in q.pg.content(), 'el precio publicado no aparece')
    check('ventas@pinos.mx' not in q.pg.content(), 'se publicó el correo interno')
    q.pg.fill('#f-name', 'Mario'); q.pg.fill('#f-email', 'mario@correo.mx'); q.pg.fill('#f-msg', '=HYPERLINK("http://x")')
    q.pg.select_option('#f-unit', label='Casa 7 (C-07)'); q.pg.check('input[name=consent]')
    q.pg.click('.sr-form button[type=submit]'); q.pg.wait_for_selector('text=Recibimos tu solicitud', timeout=8000)
    # prospectos en el panel y CSV sin fórmulas
    p.pg.get_by_role('link', name='Prospectos').click()
    p.pg.wait_for_selector('th:has-text("Mario")', timeout=6000)
    with p.pg.expect_download() as dl:
        p.pg.get_by_role('button', name='Descargar CSV').click()
    csv = Path(dl.value.path()).read_text(encoding='utf-8-sig')
    check('"\'=HYPERLINK' in csv and 'Casa 7' in csv, f'CSV: {csv[:300]}')
    p.pg.locator('select[aria-label="Estado de Mario"]').select_option('contactado')
    p.pg.wait_for_timeout(500)
    check(w.sb.sql("select status from public.leads where project_id = %s", (d['project'],))[0][0] == 'contactado', 'no cambió el estado')
    # equipo y métricas
    ed_email, _ = w.user('editora')
    p.pg.get_by_role('link', name='Equipo').click()
    p.pg.locator('.pn-inline input[type=email]').fill(ed_email)
    p.pg.locator('.pn-inline select').select_option('editor')
    p.pg.locator('.pn-inline').get_by_role('button', name='Agregar').click()
    p.pg.wait_for_selector(f'text={ed_email}', timeout=6000)
    p.pg.get_by_role('link', name='Publicaciones').click()
    p.pg.wait_for_selector('.pn-stats dt:has-text("Visitas")')
    check(p.pg.locator('.pn-stats div:has(dt:text("Visitas")) dd').inner_text() == '1', 'no se ve la visita medida')
    check(not p.errors and not q.errors, f'errores JS: {p.errors + q.errors}')

@test
def editor_no_publica_y_marca_de_organizacion(w):
    d = setup_project(w)
    ed_email, ed = w.user('editor')
    w.as_user(d['uid'], 'select public.add_project_member(%s, %s, %s)', (d['project'], ed_email, 'editor'))
    pub = w.val(d['uid'], "select public.create_publication(%s, 'showroom', %s, 'T')", (d['project'], 'ed-' + uuid.uuid4().hex[:6]))
    w.val(d['uid'], "select public.create_publication_version(%s, '')", (pub,))
    p = w.page(ed_email)
    p.pg.goto(w.base + f'apps/panel/#/p/{d["project"]}/publicaciones')
    p.pg.wait_for_selector('.pn-card', timeout=8000)
    check(p.pg.get_by_role('button', name='Publicar', exact=True).count() == 0, 'el editor ve «Publicar»')
    p.pg.get_by_role('button', name='Pedir revisión al propietario').click()
    p.pg.wait_for_selector('.ag-pill:has-text("En revisión")', timeout=6000)
    check(p.pg.get_by_role('link', name='Actividad').count() == 0, 'el editor ve la bitácora')
    # marca: el editor del proyecto no es admin de la organización
    p.pg.goto(w.base + f'apps/panel/#/org/{d["org"]}/marca')
    p.pg.wait_for_selector('text=Solo propietarios y administradores', timeout=6000)
    o = w.page(d['email'])
    o.pg.goto(w.base + f'apps/panel/#/org/{d["org"]}/marca')
    o.pg.wait_for_selector('legend:has-text("Marca")', timeout=8000)
    o.pg.get_by_label('Nombre comercial (se muestra)').fill('Estudio Lumbre')
    o.ev("(() => { const c = document.querySelector('input[type=color]'); c.value = '#1f5c4a'; c.dispatchEvent(new Event('input')); })()")
    check('blanco' in o.pg.inner_text('.pn-swatch'), 'no calculó el texto legible sobre el acento')
    o.pg.get_by_role('button', name='Guardar').click()
    o.pg.wait_for_selector('text=Guardado.', timeout=6000)
    b = w.sb.sql('select branding from public.organizations where id = %s', (d['org'],))[0][0]
    check(b['accent'] == '#1F5C4A' and b['name'] == 'Estudio Lumbre', f'marca: {b}')
    o.pg.get_by_role('link', name='Uso y cuota').click()
    o.pg.wait_for_selector('text=Grace period', timeout=6000)
    o.pg.goto(w.base + f'apps/panel/#/p/{d["project"]}/actividad')
    o.pg.wait_for_selector('.pn-audit li', timeout=6000)
    check('Tú creó el proyecto' in o.pg.inner_text('.pn-audit') or 'creó' in o.pg.inner_text('.pn-audit'), 'bitácora vacía')
    o.pg.get_by_role('link', name='Exportar').click()
    with o.pg.expect_download() as dl:
        o.pg.get_by_role('button', name='Descargar exportación').click()
    data = json.loads(Path(dl.value.path()).read_text())
    check(data['format'] == 'agelarq-project-export' and data['tree']['scenes'], 'exportación incompleta')
    check(not p.errors and not o.errors, f'errores JS: {p.errors + o.errors}')

@test
def panel_vistas_zonas_y_revision(w):
    d = setup_project(w, 'Lomas del Bosque')
    # una escena más con un punto de navegación roto
    tree = w.as_user(d['uid'], 'select public.load_project_tree(%s)', (d['project'],))[0][0]
    tree['scenes'][0]['hs'] = [{'id': str(uuid.uuid4()), 'type': 'scene', 'x': 50, 'y': 50, 'title': 'A ninguna parte', 'target_scene_id': None}]
    w.as_user(d['uid'], 'select public.save_project_tree(%s, %s, %s)', (d['project'], json.dumps(tree), tree['revision']))
    tower = w.val(d['uid'], "insert into public.spaces (project_id, kind, name) values (%s, 'edificio', 'Torre Norte') returning id", (d['project'],))
    u1 = w.val(d['uid'], "insert into public.spaces (project_id, parent_id, kind, name, availability, position) values (%s, %s, 'unidad', 'Casa 1', 'disponible', 1) returning id", (d['project'], tower))
    w.val(d['uid'], "insert into public.spaces (project_id, parent_id, kind, name, availability, position) values (%s, %s, 'unidad', 'Casa 2', 'no_aplica', 2) returning id", (d['project'], tower))
    p = w.page(d['email'])
    p.pg.goto(w.base + f'apps/panel/#/p/{d["project"]}/showroom')
    p.pg.wait_for_selector('legend:has-text("Explorar")', timeout=8000)
    p.pg.get_by_label('Qué superficie publicas').select_option('interior')
    vfile = p.pg.locator('fieldset:has(legend:has-text("Explorar")) input[type=file]')
    vfile.set_input_files(str(FIXTURES / 'pano_c.jpg'))
    p.pg.wait_for_selector('.pn-views li', timeout=10000)
    p.pg.get_by_role('button', name='Dibujar zonas').click()
    stage = p.pg.locator('.pn-vstage'); stage.wait_for()
    b = stage.bounding_box()
    for fx, fy in [(.1, .1), (.3, .1), (.3, .4), (.1, .4)]:
        p.pg.mouse.click(b['x'] + b['width'] * fx, b['y'] + b['height'] * fy)
    p.pg.get_by_label('Zona de',exact=True).select_option(str(u1))
    p.pg.get_by_role('button', name='Cerrar zona').click()
    check(p.pg.locator('.pn-vstage path').count()>0,'no se dibujó la zona')
    p.pg.get_by_role('button', name='Colocar escenas 360°').click()
    p.pg.mouse.click(b['x'] + b['width'] * .6, b['y'] + b['height'] * .5)
    modal_btn(p, 'Listo y guardar').click()
    p.pg.wait_for_selector('text=Guardado en este dispositivo.', timeout=8000)
    sync_panel(p)
    sr = w.sb.sql('select showroom from public.projects where id = %s', (d['project'],))[0][0]
    v = sr['views'][0]
    check(sr['area_label'] == 'interior' and v['regions'][0]['space'] == str(u1) and len(v['regions'][0]['points']) == 4, f'zonas: {v}')
    check(abs(v['regions'][0]['points'][1][0] - 30) < 1.5 and v['spots'][0]['scene'] == d['scene'], f'coordenadas o punto 360°: {v}')
    # revisión antes de publicar
    p.pg.get_by_role('link', name='Publicaciones').click()
    p.pg.get_by_role('button', name='Nueva publicación').click()
    p.pg.get_by_label('Dirección').fill('lomas-' + uuid.uuid4().hex[:5])
    modal_btn(p, 'Crear').click()
    p.pg.get_by_role('button', name='Crear versión con el contenido actual').click()
    p.pg.wait_for_selector('text=Revisión antes de crear la versión', timeout=8000)
    txt = p.pg.inner_text('.ag-modal')
    check('A ninguna parte' in txt and 'Por confirmar' in txt and 'Casa 2' in txt, f'revisión: {txt[:600]}')
    shot(p, 'panel-revision')
    modal_btn(p, 'Crear versión de todos modos').click()
    p.pg.wait_for_selector('button:has-text("Publicar")', timeout=8000)
    p.pg.get_by_role('button', name='En celular').click()
    p.pg.wait_for_selector('.pn-phone iframe')
    frame = p.pg.frame_locator('.pn-phone iframe')
    frame.locator('#explora .sr-zone').first.wait_for(timeout=10000)
    check(frame.locator('.sr-preview').count() == 1, 'la vista previa en celular no muestra la versión')
    check(not p.errors, f'errores JS: {p.errors}')


def main():
    only = sys.argv[sys.argv.index('-k') + 1] if '-k' in sys.argv else None
    sb = MiniSupa.start('agel_e2e_bim')
    aps = FakeAps()
    fport = free_port()
    env = dict(os.environ, SUPABASE_URL=sb.url, SUPABASE_ANON_KEY=sb.anon_key,
               SUPABASE_SERVICE_ROLE_KEY=jwt_sign({'role': 'service_role', 'iss': 'minisupa', 'exp': int(time.time()) + 86400}),
               APS_CLIENT_ID='cliente-prueba', APS_CLIENT_SECRET='secreto-prueba', APS_BASE_URL=aps.url)
    fn = subprocess.Popen([DENO, 'run', '--allow-net', '--allow-env', str(REPO / 'supabase/functions/tests/serve_local.ts'), str(fport)],
                          env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for _ in range(100):
        try: socket.create_connection(('127.0.0.1', fport), timeout=0.2).close(); break
        except OSError: time.sleep(0.1)
    for name in ('aps-upload', 'aps-translate', 'aps-status', 'aps-token', 'lead-notify'):
        sb.functions[name] = f'http://127.0.0.1:{fport}/{name}'
    base, srv = serve(REPO / 'index.html')
    site = Path(os.environ.get('AGEL_SITE', '/tmp/agel_site'))
    (site / 'config.js').write_text(f"window.AGEL_CONFIG = {{ supabaseUrl: '{HOST}', supabaseAnonKey: '{sb.anon_key}', siteUrl: '' }};")
    (site / 'apps/panel/robots.txt').write_text('')
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        for t in TESTS:
            if only and only not in t.__name__: continue
            w = World(browser, base, sb, aps); t0 = time.time()
            try: t(w); status, info = 'PASS', ''
            except AssertionError as e: status, info = 'FAIL', str(e)
            except Exception as e: status, info = 'ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:240]}'
            if status != 'PASS' and os.environ.get('AGEL_DEBUG'):
                for ci, c in enumerate(w.ctxs):
                    for pi, pg in enumerate(c.pages):
                        try: pg.screenshot(path=f'/tmp/fail_{t.__name__}_{ci}{pi}.png'); print('   ', pg.url, pg.inner_text('body')[:600].replace('\n', ' | '))
                        except Exception as ex: print('    (sin captura)', ex)
            w.close(); results.append(status)
            print(f'{status:5}  {t.__name__:44} {time.time()-t0:5.1f}s  {info[:300]}', flush=True)
        browser.close()
    fn.terminate(); srv.shutdown(); sb.stop()
    ok = results.count('PASS')
    print(f'\n{ok}/{len(results)} pruebas de panel y BIM superadas')
    sys.exit(0 if ok == len(results) else 1)

if __name__ == '__main__':
    main()
