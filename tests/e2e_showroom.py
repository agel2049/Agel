#!/usr/bin/env python3
"""
AgelArq — pruebas del showroom público (fase 3) en navegador real contra
mini-Supabase (Postgres + PostgREST reales con todas las migraciones).

Uso:
    python3 tests/e2e_showroom.py               # todas
    python3 tests/e2e_showroom.py -k recorrido  # filtro
    python3 tests/e2e_showroom.py --shots DIR   # además guarda capturas
"""
import json, os, re, subprocess, sys, time, uuid
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import sync_playwright
from e2e import serve, FIXTURES, Page, check
from e2e_cloud import wire_cloud, HOST
from minisupa import MiniSupa
from glb_fixture import glb_bytes

REPO = Path(__file__).resolve().parent.parent
IMG = 'https://img.agel-pruebas.mx'
TESTS = []
def test(fn): TESTS.append(fn); return fn
SHOTS = Path(sys.argv[sys.argv.index('--shots') + 1]) if '--shots' in sys.argv else None


class World:
    def __init__(self, browser, base, sb):
        self.browser, self.base, self.sb = browser, base, sb
        self.ctxs = []

    def page(self, width=1280, height=860, js=True):
        ctx = self.browser.new_context(viewport={'width': width, 'height': height}, java_script_enabled=js)
        wire_cloud(ctx, self.sb)
        def img(route, request):
            name = request.url.split('?')[0].rsplit('/', 1)[-1]
            f = FIXTURES / name
            if f.exists():
                return route.fulfill(path=str(f), headers={'access-control-allow-origin': '*', 'content-type': 'image/jpeg'})
            route.fulfill(status=404, body='')
        ctx.route(re.compile(re.escape(IMG) + r'/.*'), img)
        self.ctxs.append(ctx)
        return Page(ctx, self.base)

    def as_user(self, uid, sql, params=None):
        return self.sb._as({'sub': uid, 'role': 'authenticated'}, sql, params)

    def val(self, uid, sql, params=None):
        v = self.as_user(uid, sql, params)[0][0]
        return str(v) if isinstance(v, uuid.UUID) else v

    def close(self):
        for c in self.ctxs:
            # Deja terminar las peticiones simuladas antes de retirar sus rutas.
            try:
                for page in c.pages: page.wait_for_load_state('networkidle', timeout=5000)
                c.unroute_all(behavior='wait')
            except Exception: pass
            try: c.close()
            except Exception: pass


def seed(w, slug=None, evil=False, publish=True, extra=False):
    """Proyecto con dos torres, cuatro departamentos, dos escenas y contenido."""
    slug = slug or f'torre-lumbre-{uuid.uuid4().hex[:6]}'
    email = f'duena-{uuid.uuid4().hex[:6]}@prueba.mx'
    uid = w.sb.create_user(email)
    X = '<img src=x onerror="window.__xss=1">' if evil else ''
    org = w.val(uid, 'select public.create_organization(%s)', ('Estudio Lumbre',))
    p = w.val(uid, "select public.create_project(%s, %s, 'desarrollo')", (org, 'Torre Lumbre' + X))
    s0, s1 = str(uuid.uuid4()), str(uuid.uuid4())
    tree = {'project': {'name': 'Torre Lumbre' + X}, 'scenes': [
        {'id': s0, 'name': 'Sala' + X, 'meta': 'Planta tipo', 'pano_url': f'{IMG}/pano_a.jpg', 'preview_url': f'{IMG}/pano_c.jpg?vista=ligera', 'heading': -10, 'hs': [
            {'id': str(uuid.uuid4()), 'type': 'scene', 'x': 55, 'y': 50, 'title': 'Ir a la terraza', 'target_scene_id': s1},
            {'id': str(uuid.uuid4()), 'type': 'info', 'x': 45, 'y': 52, 'title': 'Piso de encino' + X, 'details': ['Duela de 19 mm', 'Acabado mate']}]},
        {'id': s1, 'name': 'Terraza', 'meta': 'Nivel 8', 'hs': [
            {'id': str(uuid.uuid4()), 'type': 'scene', 'x': 50, 'y': 50, 'title': 'Volver a la sala', 'target_scene_id': s0}]}]}
    # URL que intenta salir de url('…') en el CSS de la franja y las miniaturas
    # (en la ruta: el navegador no codifica comillas ni paréntesis ahí)
    tree['scenes'][1]['pano_url'] = f"{IMG}/b');background-image:url('https://evil.example/x" if evil else f'{IMG}/pano_b.jpg'
    w.val(uid, 'select public.save_project_tree(%s, %s, %s)', (p, json.dumps(tree), 0))
    showroom = {
        'tagline': 'Departamentos con vista al bosque de Morelia' + X,
        'description': 'Veinticuatro departamentos en dos torres de ocho niveles.\n\nCantera, madera y luz natural.' + X,
        'highlights': ['Terraza en cada departamento', 'A 5 minutos de Altozano' + X],
        'amenities': ['Alberca', 'Gimnasio', 'Roof garden'],
        'gallery': [{'url': f'{IMG}/pano_c.jpg', 'caption': 'Fachada norte' + X}, {'url': f'{IMG}/pano_c.jpg?lobby', 'caption': 'Lobby'}],
        'plans': [{'url': f"{IMG}/plano.pdf", 'title': 'Planta tipo'}],
        'location': {'address': 'Av. Montaña Monarca 1000, Morelia, Mich.', 'map_url': 'https://maps.example/lumbre'},
        'contact': {'cta': 'Agendar visita' + ('"><script>window.__xss=1</script>' if evil else ''), 'whatsapp': '+52 443 123 4567',
                    'email': 'ventas@lumbre.mx', 'hours': 'de lunes a sábado'},
        'seo': {'title': 'Torre Lumbre, departamentos en Morelia', 'description': 'Departamentos de 2 y 3 recámaras.'},
        'notify_email': 'secreto@lumbre.mx',
        'model3d': {'url': f'{IMG}/silla.glb', 'title': 'Silla Lumbre'},
        'area_label': 'interior',
        'progress': [{'date': '2026-09', 'title': 'Estructura nivel 4' + X, 'note': 'Colado de losa.', 'images': [f'{IMG}/pano_c.jpg?obra1', f'{IMG}/pano_b.jpg?obra2']}]
    }
    if evil:
        showroom['gallery'].append({'url': f"{IMG}/pano_b.jpg?a=');background:url('https://evil.example/x", 'caption': 'css'})
    w.sb.sql("update public.projects set location = 'Morelia, Michoacán', delivery = 'Diciembre 2027', showroom = %s where id = %s",
             (json.dumps(showroom), p))
    w.sb.sql("update public.organizations set branding = %s where id = %s",
             (json.dumps({'name': 'Lumbre Desarrollos', 'accent': '#1F5C4A'}), org))
    ins = lambda kind, name, parent=None, **k: w.val(uid,
        'insert into public.spaces (project_id, parent_id, kind, name, code, area_m2, bedrooms, bathrooms, parking, price, show_price, availability, scene_ids, position) '
        'values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid[], %s) returning id',
        (p, parent, kind, name, k.get('code', ''), k.get('area'), k.get('bed'), k.get('bath'), k.get('park'), k.get('price'),
         k.get('show', False), k.get('av', 'no_aplica'), k.get('scenes', []), k.get('pos', 0)))
    ta = ins('edificio', 'Torre A', pos=0); tb = ins('edificio', 'Torre B', pos=1)
    units = {
        'A-101': ins('unidad', 'Depto 101' + X, ta, code='A-101', area=92.5, bed=2, bath=2, park=1, price=4250000, show=True, av='disponible', scenes=[s0], pos=1),
        'A-102': ins('unidad', 'Depto 102', ta, code='A-102', area=118, bed=3, bath=2.5, park=2, price=5100000, show=True, av='apartada', pos=2),
        'B-201': ins('unidad', 'Depto 201', tb, code='B-201', area=92.5, bed=2, bath=2, park=1, price=4300000, show=True, av='vendida', pos=3),
        'B-202': ins('unidad', 'Depto 202', tb, code='B-202', area=131, bed=3, bath=3, park=2, price=6789123, show=False, av='disponible', pos=4),
    }
    if extra:
        units['B-203'] = ins('unidad', 'Depto 203', tb, code='B-203', area=88, bed=1, bath=1, price=None, av='no_aplica', pos=5)
    # Render del conjunto con zonas (unidad y torre) y plano con las dos escenas.
    showroom['views'] = [
        {'id': 'conjunto', 'title': 'Conjunto', 'image': f'{IMG}/pano_c.jpg?render', 'w': 1600, 'h': 900,
         'regions': [{'space': units['A-101'], 'points': [[10, 10], [30, 10], [30, 40], [10, 40]]},
                     {'space': units['A-102'], 'points': [[10, 45], [30, 45], [30, 75], [10, 75]]},
                     {'space': tb, 'points': [[60, 10], [90, 10], [90, 80], [60, 80]]}],
         'spots': [{'scene': s0, 'x': 40, 'y': 50}]},
        {'id': 'planta', 'title': 'Planta tipo', 'kind': 'plano', 'image': f'{IMG}/pano_b.jpg?planta', 'w': 1200, 'h': 800,
         'regions': [], 'spots': [{'scene': s0, 'x': 30, 'y': 40}, {'scene': s1, 'x': 70, 'y': 60}]}]
    w.sb.sql("update public.projects set showroom = %s where id = %s", (json.dumps(showroom), p))
    pub = w.val(uid, "select public.create_publication(%s, 'showroom', %s, 'Torre Lumbre')", (p, slug))
    ver = w.val(uid, "select public.create_publication_version(%s, 'primera')", (pub,))
    if publish: w.as_user(uid, 'select public.publish_version(%s)', (ver,))
    return {'slug': slug, 'uid': uid, 'email': email, 'project': p, 'pub': pub, 'version': ver, 'units': units, 'scenes': [s0, s1], 'towers': [ta, tb]}


def open_showroom(w, query, **kw):
    p = w.page(**kw)
    p.pg.goto(w.base + 'apps/showroom/' + query, wait_until='load')
    return p

def metrics(w, d):
    rows = w.sb.sql('select event, count from public.publication_metrics where publication_id = %s', (d['pub'],))
    return {e: c for e, c in rows}

def wait_metric(w, d, ev, n=1, timeout=5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if metrics(w, d).get(ev, 0) >= n: return True
        time.sleep(0.1)
    return False

def shot(p, name, full=False):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        p.pg.screenshot(path=str(SHOTS / f'{name}.png'), full_page=full)


@test
def showroom_publicado_se_ve_completo(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}')
    p.pg.wait_for_selector('#sr-title', timeout=8000)
    check(p.pg.inner_text('#sr-title') == 'Torre Lumbre', 'falta el nombre del proyecto')
    check(p.pg.title() == 'Torre Lumbre, departamentos en Morelia', f'título SEO: {p.pg.title()}')
    check(p.ev("getComputedStyle(document.documentElement).getPropertyValue('--sr-accent').trim()") == '#1F5C4A', 'no aplicó el color de la marca')
    check(p.ev("getComputedStyle(document.documentElement).getPropertyValue('--sr-accent-ink').trim()") == '#FFFFFF', 'texto del acento ilegible')
    check(p.pg.locator('tr[data-unit-row]').count() == 4, 'no están las 4 unidades')
    html = p.pg.content()
    check('$4,250,000' in html and 'Consultar' in html, 'precios: falta el visible o el «Consultar»')
    check('6,789,123' not in html and '6789123' not in html, 'se filtró un precio oculto')
    check('secreto@lumbre.mx' not in html, 'se filtró el correo interno de avisos')
    check(p.pg.locator('dl.sr-facts').inner_text().count('2 de 4') == 1, 'resumen de disponibilidad incorrecto')
    check(wait_metric(w, d, 'page_view'), 'no se contó la visita')
    check(p.ev("typeof THREE") == 'undefined', 'three.js se descargó sin abrir el recorrido')
    shot(p, 'showroom-1280')
    shot(p, 'showroom-1280-completo', full=True)
    check(not p.errors, f'errores JS: {p.errors}')

@test
def filtros_y_ficha_de_unidad(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}')
    p.pg.wait_for_selector('#unidades')
    p.pg.get_by_role('button', name='Torre B', exact=True).click()
    visible = p.ev("[...document.querySelectorAll('tr[data-unit-row]')].filter(r => !r.hidden).map(r => r.querySelector('.sr-code').textContent)")
    check(visible == ['B-201', 'B-202'], f'filtro por torre: {visible}')
    p.pg.get_by_label('Solo disponibles').check()
    visible = p.ev("[...document.querySelectorAll('tr[data-unit-row]')].filter(r => !r.hidden).length")
    check(visible == 1, f'filtro de disponibles: {visible}')
    p.pg.get_by_role('button', name='Todas').click()
    p.pg.get_by_label('Solo disponibles').uncheck()
    p.pg.locator('.sr-unit-open', has_text='Depto 102').click()
    p.pg.wait_for_selector('dialog.sr-drawer[open]')
    check('unidad=' + d['units']['A-102'] in p.ev('location.search'), 'la ficha no quedó en la dirección')
    txt = p.pg.inner_text('dialog.sr-drawer')
    check('118 m²' in txt and '$5,100,000' in txt and 'Apartada' in txt and 'Torre A' in txt, f'ficha incompleta: {txt[:200]}')
    p.pg.keyboard.press('Escape')
    p.wait("!document.querySelector('dialog.sr-drawer')")
    check('unidad=' not in p.ev('location.search'), 'la dirección conserva la ficha cerrada')
    check(p.ev("document.activeElement && document.activeElement.textContent.includes('Depto 102')"), 'el foco no volvió a la tabla')
    p.pg.goto(w.base + f'apps/showroom/?p={d["slug"]}&unidad={d["units"]["A-101"]}')
    p.pg.wait_for_selector('dialog.sr-drawer[open]', timeout=8000)
    check('Depto 101' in p.pg.inner_text('dialog.sr-drawer h2'), 'el enlace directo no abrió la ficha')
    check(wait_metric(w, d, 'unit_view', 2), 'no se contaron las fichas vistas')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def solicitud_con_unidad_y_origen(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}&utm_source=facebook&utm_campaign=preventa&unidad={d["units"]["A-101"]}')
    p.pg.wait_for_selector('dialog.sr-drawer[open]', timeout=8000)
    p.pg.get_by_role('button', name='Pedir información de Depto 101').click()
    check(p.ev("document.getElementById('f-unit').value") == d['units']['A-101'], 'no se preseleccionó la unidad')
    p.pg.fill('#f-name', 'Laura Méndez')
    p.pg.fill('#f-email', 'laura@correo.mx')
    p.pg.click('.sr-form button[type=submit]')
    p.pg.wait_for_selector('.sr-form-error:has-text("autorización")')
    check(w.sb.sql('select count(*) from public.leads where project_id = %s', (d['project'],))[0][0] == 0, 'se envió sin consentimiento')
    p.pg.check('input[name=consent]')
    p.pg.click('.sr-form button[type=submit]')
    p.pg.wait_for_selector('text=Recibimos tu solicitud', timeout=8000)
    check('Depto 101' in p.pg.inner_text('.sr-done'), 'la confirmación no menciona la unidad')
    rows = w.sb.sql('select name, email, space_id, space_label, source from public.leads where project_id = %s', (d['project'],))
    check(len(rows) == 1, f'prospectos: {rows}')
    name, email, space, label, src = rows[0]
    check(str(space) == d['units']['A-101'] and 'Depto 101' in label, f'unidad del prospecto: {space} {label}')
    check(src.get('utm_source') == 'facebook' and src.get('utm_campaign') == 'preventa' and src.get('path', '').endswith('/apps/showroom/'),
          f'origen: {src}')
    check(wait_metric(w, d, 'lead_submitted') and wait_metric(w, d, 'contact_start'), 'no se midió el contacto')
    # robot: rellena el campo oculto → se le muestra "recibido" pero no se guarda
    q = open_showroom(w, f'?p={d["slug"]}')
    q.pg.wait_for_selector('.sr-form')
    q.ev("document.getElementById('f-company').value = 'Spam SA'")
    q.pg.fill('#f-name', 'Robot'); q.pg.fill('#f-email', 'robot@spam.mx'); q.pg.check('input[name=consent]')
    q.pg.click('.sr-form button[type=submit]')
    q.pg.wait_for_selector('text=Recibimos tu solicitud')
    check(w.sb.sql('select count(*) from public.leads where project_id = %s', (d['project'],))[0][0] == 1, 'el robot guardó un prospecto')
    check(not p.errors and not q.errors, f'errores JS: {p.errors + q.errors}')

@test
def recorrido_bajo_demanda(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}')
    reqs = []
    p.pg.on('request', lambda r: reqs.append(r.url))
    p.pg.wait_for_selector('.sr-horizon-cta')
    check(not any('three.min.js' in u for u in reqs), 'three.js se pidió antes de tiempo')
    p.pg.click('.sr-horizon-cta')
    p.pg.wait_for_selector('dialog.sr-tour-dlg[open] canvas', timeout=8000)
    p.wait("document.querySelector('.sr-tour-title') && document.querySelector('.sr-tour-title').textContent.startsWith('Sala')", 10000)
    check(p.ev("typeof AgelPano") == 'object', 'no cargó el motor 360')
    check('escena=0' in p.ev('location.search'), 'la escena no quedó en la dirección')
    p.pg.wait_for_timeout(300); shot(p, 'showroom-recorrido')
    p.pg.locator('.sr-hs-info').click(force=True)
    p.pg.wait_for_selector('.sr-card h3:has-text("Piso de encino")')
    check('Duela de 19 mm' in p.pg.inner_text('.sr-card'), 'la ficha del hotspot no muestra detalles')
    p.pg.locator('.sr-hs-scene', has_text='Ir a la terraza').click(force=True)
    p.wait("document.querySelector('.sr-tour-title').textContent.startsWith('Terraza')", 10000)
    p.pg.get_by_role('button', name='Sala', exact=True).click()
    p.wait("document.querySelector('.sr-tour-title').textContent.startsWith('Sala')", 10000)
    p.pg.keyboard.press('Escape')
    p.wait("!document.querySelector('dialog.sr-tour-dlg')")
    check('escena=' not in p.ev('location.search'), 'la dirección conserva la escena')
    check(wait_metric(w, d, 'tour_open') and wait_metric(w, d, 'scene_view', 3), f'métricas del recorrido: {metrics(w, d)}')
    # se puede volver a abrir (el motor anterior se liberó)
    p.pg.locator('#recorrido [data-tour="1"]').click()
    p.wait("document.querySelector('.sr-tour-title') && document.querySelector('.sr-tour-title').textContent.startsWith('Terraza')", 10000)
    check(not p.errors, f'errores JS: {p.errors}')

@test
def modelo_3d_y_recorrido_guiado(w):
    d = seed(w)
    p = w.page()
    reqs = []
    p.pg.on('request', lambda r: reqs.append(r.url))
    vendor = REPO / 'tests/vendor/node_modules/three'
    p.pg.context.route('https://cdn.jsdelivr.net/npm/three@0.128.0/**', lambda r: r.fulfill(
        path=str(vendor / urlparse(r.request.url).path.split('three@0.128.0/')[1])))
    p.pg.context.route(f'{IMG}/silla.glb', lambda r: r.fulfill(
        content_type='model/gltf-binary', body=glb_bytes(), headers={'access-control-allow-origin': '*'}))
    p.pg.goto(w.base + f'apps/showroom/?p={d["slug"]}')
    p.pg.wait_for_selector('#modelo')
    check(not any('three.min.js' in u or u.endswith('silla.glb') for u in reqs), 'la maqueta se descargó sin pedirla')
    p.pg.get_by_role('button', name='Ver en 3D').click()
    p.pg.get_by_role('dialog', name='Maqueta virtual').get_by_role('status').filter(has_text='3 de 3 piezas').wait_for()
    p.pg.get_by_role('button', name='Instalaciones (1)', exact=True).click()
    p.pg.get_by_role('status').filter(has_text='1 de 3 piezas').wait_for()
    p.pg.get_by_role('button', name='Cerrar maqueta', exact=True).click()
    check(p.pg.locator('dialog.mq-dialog').count() == 0, 'la maqueta no se cerró')
    p.ev("window.AGEL_GUIDE_MS = 400")
    p.pg.locator('[data-tour="0"]').first.click()
    p.wait("document.querySelector('.sr-tour-title') && document.querySelector('.sr-tour-title').textContent.startsWith('Sala')", 10000)
    p.pg.get_by_role('button', name='Recorrido guiado').click()
    p.wait("document.querySelector('.sr-tour-title').textContent.startsWith('Terraza')", 6000)
    p.wait("document.querySelector('.sr-tour-title').textContent.startsWith('Sala')", 6000)
    p.pg.locator('dialog.sr-tour-dlg canvas').click(position={'x': 200, 'y': 300})
    p.pg.wait_for_timeout(1000)
    t = p.ev("document.querySelector('.sr-tour-title').textContent")
    p.pg.wait_for_timeout(900)
    check(p.ev("document.querySelector('.sr-tour-title').textContent") == t, 'el recorrido guiado no se detuvo al tocar')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def inyeccion_no_ejecuta(w):
    d = seed(w, evil=True)
    reqs = []
    p = w.page()
    p.pg.on('request', lambda r: reqs.append(r.url))
    p.pg.goto(w.base + f'apps/showroom/?p={d["slug"]}')
    p.pg.wait_for_selector('#sr-title')
    p.pg.locator('.sr-unit-open').first.click()
    p.pg.wait_for_selector('dialog.sr-drawer[open]')
    p.pg.keyboard.press('Escape')
    p.pg.locator('[data-tour="0"]').first.click()
    p.pg.wait_for_selector('.sr-hs-info', state='attached', timeout=10000)
    p.pg.locator('.sr-hs-info').click(force=True)
    p.pg.wait_for_selector('.sr-card')
    p.pg.wait_for_timeout(400)
    check(p.ev('window.__xss') is None, 'se ejecutó código inyectado')
    check('<img src=x' in p.pg.inner_text('#sr-title'), 'el texto inyectado no se muestra como texto')
    check(p.pg.locator('#sr-app script, #sr-app img[src="x"]').count() == 0, 'se creó un elemento inyectado')
    from urllib.parse import urlparse
    check(not any(urlparse(u).hostname == 'evil.example' for u in reqs), 'una URL rompió el CSS y pidió otro dominio')

@test
def vista_previa_solo_con_sesion(w):
    d = seed(w, publish=False)
    p = open_showroom(w, f'?p={d["slug"]}')
    p.pg.wait_for_selector('text=Esta página no está disponible', timeout=8000)
    p.pg.goto(w.base + f'apps/showroom/?preview={d["version"]}')
    p.pg.wait_for_selector('text=Vista previa privada', timeout=8000)
    sess = w.sb._issue(w.sb.users[d['email']])
    p.ev("s => localStorage.setItem('agel.session', s)", json.dumps(sess))
    p.pg.reload()
    p.pg.wait_for_selector('.sr-preview', timeout=8000)
    check(p.ev("document.querySelector('meta[name=robots]') && document.querySelector('meta[name=robots]').content") == 'noindex', 'la vista previa es indexable')
    check(p.ev("document.querySelector('.sr-form button[type=submit]').disabled"), 'el formulario envía en vista previa')
    intruso = w.sb.create_user(f'intruso-{uuid.uuid4().hex[:5]}@prueba.mx')
    q = open_showroom(w, '')
    q.ev("s => localStorage.setItem('agel.session', s)", json.dumps(w.sb._issue(w.sb.users[[e for e, u in w.sb.users.items() if u['id'] == intruso][0]])))
    q.pg.goto(w.base + f'apps/showroom/?preview={d["version"]}')
    q.pg.wait_for_selector('text=Esta página no está disponible', timeout=8000)
    check(q.pg.locator('#sr-title').count() == 0, 'otra cuenta vio la vista previa')

@test
def movil_sin_desbordes(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}', width=390, height=844)
    p.pg.wait_for_selector('#sr-title')
    p.pg.wait_for_timeout(300)
    check(p.ev('document.documentElement.scrollWidth') <= 390, f'la página se desborda: {p.ev("document.documentElement.scrollWidth")}px')
    check(p.ev("getComputedStyle(document.querySelector('.sr-table tr')).display") == 'grid', 'la tabla no se apila en móvil')
    # la etiqueta que envuelve una casilla es el área táctil; los enlaces dentro de un párrafo están exentos (WCAG 2.5.8)
    small = p.ev("""[...document.querySelectorAll('#sr-app button, #sr-app a, #sr-app input, #sr-app select')]
        .filter(e => e.offsetParent && !e.closest('.sr-hp'))
        .filter(e => !(e.closest('label') && e.closest('label').getBoundingClientRect().height >= 40))
        .filter(e => !(e.tagName === 'A' && e.closest('p')))
        .map(e => [e.getBoundingClientRect().height, e.textContent.trim().slice(0, 30) || e.name])
        .filter(([h]) => h < 40)""")
    check(not small, f'controles pequeños para el dedo: {small[:6]}')
    shot(p, 'showroom-390'); shot(p, 'showroom-390-completo', full=True)
    p.pg.locator('.sr-unit-open').first.click()
    p.pg.wait_for_selector('dialog.sr-drawer[open]')
    box = p.pg.locator('dialog.sr-drawer').bounding_box()
    check(box['y'] > 50 and abs(box['y'] + box['height'] - 844) < 2, f'la ficha no es hoja inferior: {box}')
    p.pg.wait_for_timeout(200); shot(p, 'showroom-390-ficha')

@test
def pagina_pregenerada_sin_javascript(w):
    d = seed(w)
    out = Path(os.environ.get('AGEL_SITE', '/tmp/agel_site'))
    env = dict(os.environ, AGEL_API_URL=w.sb.url, AGEL_ANON_KEY=w.sb.anon_key)
    r = subprocess.run(['node', str(REPO / 'scripts/prerender-showroom.mjs'), '--out', str(out), '--site', 'https://agel.example/'],
                       capture_output=True, text=True, env=env, cwd=out, timeout=60)
    check(r.returncode == 0, f'prerender falló: {r.stderr[-400:]}')
    page = out / 'p' / d['slug'] / 'index.html'
    check(page.exists(), f'no se generó {page}')
    html = page.read_text()
    check('application/ld+json' in html and 'rel="canonical" href="https://agel.example/p/' in html, 'faltan metadatos')
    check('secreto@lumbre.mx' not in html and '6789123' not in html, 'datos privados en la página estática')
    check(f'<loc>https://agel.example/p/{d["slug"]}/</loc>' in (out / 'sitemap.xml').read_text(), 'falta en el sitemap')
    p = w.page(js=False)
    p.pg.goto(w.base + f'p/{d["slug"]}/')
    check(p.pg.inner_text('#sr-title') == 'Torre Lumbre', 'sin JavaScript no se ve el contenido')
    check(p.pg.locator('tr[data-unit-row]').count() == 4, 'sin JavaScript faltan unidades')
    q = w.page()
    q.pg.goto(w.base + f'p/{d["slug"]}/')
    q.pg.wait_for_selector('.sr-horizon-cta')
    q.pg.click('.sr-horizon-cta')
    q.pg.wait_for_selector('dialog.sr-tour-dlg[open] canvas', timeout=8000)
    q.wait("document.querySelector('.sr-tour-title') && document.querySelector('.sr-tour-title').textContent.startsWith('Sala')", 10000)
    check(not q.errors, f'errores JS en la página estática: {q.errors}')

@test
def marcadores_arrastre_y_teclado(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}')
    p.pg.wait_for_selector('.sr-horizon-cta'); p.pg.click('.sr-horizon-cta')
    p.wait("document.querySelector('.sr-tour-title') && document.querySelector('.sr-tour-title').textContent.startsWith('Sala')", 10000)
    p.pg.wait_for_timeout(300)
    # arrastre que empieza y termina sobre el marcador: gira, no navega
    b = p.pg.locator('.sr-hs-scene').bounding_box()
    x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
    p.pg.mouse.move(x, y); p.pg.mouse.down(); p.pg.mouse.move(x + 80, y + 4, steps=8); p.pg.mouse.move(x + 2, y, steps=8); p.pg.mouse.up()
    p.pg.wait_for_timeout(900)
    check(p.ev("document.querySelector('.sr-tour-title').textContent").startswith('Sala'), 'arrastrar sobre el marcador cambió de escena')
    # el foco inicial está en la vista y las flechas giran
    check(p.ev("document.activeElement.classList.contains('sr-tour-stage')"), 'el foco no quedó en la vista 360°')
    before = p.ev("getComputedStyle(document.querySelector('.sr-hs-scene')).getPropertyValue('--hx')")
    for _ in range(4): p.pg.keyboard.press('ArrowRight')
    p.pg.wait_for_timeout(200)
    check(p.ev("getComputedStyle(document.querySelector('.sr-hs-scene')).getPropertyValue('--hx')") != before, 'las flechas no giran la vista')
    # girar 180°: los marcadores quedan detrás y fuera del orden de tabulación
    for _ in range(30): p.pg.keyboard.press('ArrowRight')
    p.pg.wait_for_timeout(300)
    hidden = p.ev("[...document.querySelectorAll('.sr-hs')].filter(e => e.style.opacity === '0')")
    check(p.ev("[...document.querySelectorAll('.sr-hs')].filter(e => e.style.opacity === '0').every(e => e.inert)"), 'un marcador oculto sigue enfocable')
    check(p.ev("[...document.querySelectorAll('.sr-hs')].some(e => e.style.opacity === '0')"), f'ningún marcador quedó detrás: {hidden}')
    # toque simple sí navega
    p.pg.keyboard.press('Home')
    for _ in range(34): p.pg.keyboard.press('ArrowLeft')
    p.pg.wait_for_timeout(300)
    p.pg.locator('.sr-hs-scene').click()
    p.wait("document.querySelector('.sr-tour-title').textContent.startsWith('Terraza')", 6000)
    check(not p.errors, f'errores JS: {p.errors}')

@test
def explora_zonas_ficha_y_plano(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}')
    p.pg.wait_for_selector('#explora .sr-zone')
    check(p.pg.locator('#explora .sr-view:not([hidden]) .sr-zone').count() == 3, 'faltan zonas en el render')
    check(p.ev("document.querySelector('.sr-zone[data-space=\"%s\"]').classList.contains('sr-zone-disponible')" % d['units']['A-101']), 'la zona no refleja el estado')
    label = p.ev("document.querySelector('.sr-zone[data-space=\"%s\"]').getAttribute('aria-label')" % d['towers'][1])
    check(label == 'Torre B, 1 de 2 disponibles', f'etiqueta de la torre: {label}')
    # zona de unidad → ficha; desde la ficha «Ver en el plano» vuelve y la resalta
    p.pg.locator('.sr-zone[data-space="%s"]' % d['units']['A-101']).click()
    p.pg.wait_for_selector('dialog.sr-drawer[open]')
    p.pg.get_by_role('button', name='Ver en el plano').click()
    p.wait("document.querySelector('.sr-zone.is-located')", 4000)
    check(p.ev("document.activeElement.dataset.space") == d['units']['A-101'], 'el foco no quedó en la zona')
    # zona de torre → filtra la lista
    p.pg.locator('.sr-zone[data-space="%s"]' % d['towers'][1]).press('Enter')
    p.wait("document.querySelector('[data-count]').textContent.startsWith('Mostrando 2 de 4')", 4000)
    # pestañas por teclado y punto 360° del plano
    p.pg.locator('[data-view-tab="0"]').focus(); p.pg.keyboard.press('ArrowRight')
    check(p.ev("!document.querySelector('#sr-vp-1').hidden && document.querySelector('#sr-vp-0').hidden"), 'la flecha no cambió de vista')
    p.pg.locator('#sr-vp-1 .sr-spot[data-tour="1"]').click()
    p.wait("document.querySelector('.sr-tour-title') && document.querySelector('.sr-tour-title').textContent.startsWith('Terraza')", 10000)
    # «Estás aquí» dentro del recorrido
    p.pg.get_by_role('button', name='Plano', exact=True).click()
    p.pg.wait_for_selector('.sr-minimap .sr-mini-spot.is-here')
    check(p.ev("document.querySelector('.sr-mini-spot.is-here').getAttribute('aria-label')") == 'Terraza, estás aquí', 'el plano no marca la escena actual')
    p.pg.locator('.sr-mini-spot:not(.is-here)').click()
    p.wait("document.querySelector('.sr-tour-title').textContent.startsWith('Sala')", 6000)
    check(p.ev("document.querySelector('.sr-mini-spot.is-here').getAttribute('aria-label')") == 'Sala, estás aquí', 'el plano no siguió al cambiar de escena')
    shot(p, 'showroom-plano-en-recorrido')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def busqueda_filtros_y_orden(w):
    d = seed(w, extra=True)
    p = open_showroom(w, f'?p={d["slug"]}')
    p.pg.wait_for_selector('#f-q')
    vis = lambda: p.ev("[...document.querySelectorAll('tr[data-unit-row]')].filter(r => !r.hidden).map(r => r.querySelector('.sr-code').textContent)")
    p.pg.fill('#f-q', '202')
    check(vis() == ['B-202'], f'búsqueda: {vis()}')
    check(p.pg.inner_text('[data-count]') == 'Mostrando 1 de 5 unidades', p.pg.inner_text('[data-count]'))
    p.pg.get_by_role('button', name='Limpiar filtros').click()
    check(len(vis()) == 5 and p.pg.inner_text('[data-count]') == '5 unidades', 'limpiar no restauró la lista')
    p.pg.select_option('#f-bed', '3')
    check(vis() == ['A-102', 'B-202'], f'recámaras: {vis()}')
    p.pg.select_option('#f-bed', '')
    p.pg.locator('.sr-sort[data-sort="price"]').click()
    order = p.ev("[...document.querySelectorAll('tr[data-unit-row]')].map(r => r.querySelector('.sr-code').textContent)")
    check(order[:3] == ['A-101', 'B-201', 'A-102'], f'orden por precio: {order}')
    check(p.ev("document.querySelector('.sr-sort[data-sort=\"price\"]').closest('th').getAttribute('aria-sort')") == 'ascending', 'aria-sort')
    # estado desconocido y superficie con su tipo
    row = p.pg.locator('tr[data-unit-row="%s"]' % d['units']['B-203'])
    check('Por confirmar' in row.inner_text(), 'el estado desconocido no se dice como tal')
    check(p.pg.inner_text('th.c-area_m2') == 'Superficie interior (m²)', p.pg.inner_text('th.c-area_m2'))
    p.pg.locator('.sr-unit-open', has_text='Depto 101').click()
    txt = p.pg.inner_text('dialog.sr-drawer')
    check('Superficie interior' in txt and 'Precio y estado actualizados el' in txt, f'ficha: {txt[:300]}')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def seleccion_comparar_compartir_y_contacto(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}')
    p.pg.context.grant_permissions(['clipboard-read', 'clipboard-write'])
    p.pg.wait_for_selector('.sr-save')
    p.pg.locator('.sr-save[data-save="%s"]' % d['units']['A-101']).click()
    p.pg.locator('.sr-save[data-save="%s"]' % d['units']['B-202']).click()
    p.pg.wait_for_selector('.sr-selbar:not([hidden])')
    check('Tu selección: 2' in p.pg.inner_text('.sr-selbar'), p.pg.inner_text('.sr-selbar'))
    p.pg.locator('.sr-selbar').get_by_role('button', name='Comparar').click()
    p.pg.wait_for_selector('dialog.sr-compare[open]')
    rows = p.ev("[...document.querySelectorAll('.sr-compare-table tbody tr')].map(r => [r.cells[0].textContent, r.cells[1].textContent, r.cells[2].textContent, r.classList.contains('is-diff')])")
    byname = {r[0]: r for r in rows}
    check(byname['Precio'][1] == '$4,250,000' and byname['Precio'][2] == 'Consultar', f'precio: {byname["Precio"]}')
    check(byname['Recámaras'][3] and not byname['Estado'][3], f'diferencias: {rows}')
    check(byname['Recorrido 360°'][2] == 'No disponible', 'falta el dato ausente')
    shot(p, 'showroom-comparar')
    p.pg.keyboard.press('Escape')
    p.pg.locator('.sr-selbar').get_by_role('button', name='Compartir').click()
    p.pg.wait_for_timeout(300)
    link = p.ev("navigator.clipboard.readText()")
    check('sel=' in link and d['units']['A-101'] in link, f'enlace: {link}')
    # otra persona abre el enlace: recupera la selección
    q = w.page()
    q.pg.goto(link)
    q.pg.wait_for_selector('.sr-selbar:not([hidden])')
    check(q.pg.locator('.sr-toast.is-on').inner_text(timeout=6000).startswith('Abriste una selección compartida'), 'no avisó de la selección compartida')
    check('sel=' not in q.ev('location.search'), 'la dirección conserva la selección compartida')
    q.pg.locator('.sr-selbar').get_by_role('link', name='Pedir información').click()
    check(q.pg.locator('.sr-with-sel').is_visible() and 'Depto 101' in q.pg.inner_text('.sr-with-sel'), 'el formulario no ofrece incluir la selección')
    q.pg.fill('#f-name', 'Ana Ruiz'); q.pg.fill('#f-email', 'ana@correo.mx'); q.pg.check('input[name=consent]')
    q.pg.click('.sr-form button[type=submit]')
    q.pg.wait_for_selector('text=sobre tu selección (2)', timeout=8000)
    src = w.sb.sql('select source from public.leads where project_id = %s', (d['project'],))[0][0]
    check(src['seleccion'] == ['Depto 101 · A-101', 'Depto 202 · B-202'], f'selección guardada: {src}')
    check(not p.errors and not q.errors, f'errores JS: {p.errors + q.errors}')

@test
def enlace_a_unidad_retirada_y_avance(w):
    d = seed(w)
    p = open_showroom(w, f'?p={d["slug"]}&unidad={uuid.uuid4()}')
    p.pg.wait_for_selector('.sr-toast.is-on', timeout=6000)
    check('ya no está publicada' in p.pg.inner_text('.sr-toast'), p.pg.inner_text('.sr-toast'))
    check(p.ev("document.querySelector('[data-only-available]').checked"), 'no filtró las disponibles')
    check(p.pg.locator('#avance .sr-timeline > li').count() == 1 and 'septiembre 2026' in p.pg.inner_text('#avance'), 'falta el avance de obra')
    p.pg.locator('#avance .sr-shot').first.click()
    p.pg.wait_for_selector('dialog.sr-lightbox[open]')
    check('1 de 2' in p.pg.inner_text('dialog.sr-lightbox'), 'la galería del avance no abre')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def portada_ligera(w):
    d = seed(w)
    p = w.page()
    reqs = []
    p.pg.on('request', lambda r: reqs.append(r.url))
    p.pg.goto(w.base + f'apps/showroom/?p={d["slug"]}')
    p.pg.wait_for_selector('.sr-horizon'); p.pg.wait_for_timeout(600)
    check('vista=ligera' in p.ev("getComputedStyle(document.querySelector('.sr-horizon')).backgroundImage"), 'la portada no usa la versión ligera')
    check(not any(u.endswith('/pano_a.jpg') for u in reqs), 'se descargó la panorámica completa antes de abrir el recorrido')
    q = w.page(width=390, height=844)
    q.pg.goto(w.base + f'apps/showroom/?p={d["slug"]}')
    q.pg.wait_for_selector('.sr-horizon')
    check('vista=ligera' in q.ev("getComputedStyle(document.querySelector('.sr-horizon')).backgroundImage"), 'en móvil no usa la versión ligera')


def main():
    only = sys.argv[sys.argv.index('-k') + 1] if '-k' in sys.argv else None
    sb = MiniSupa.start('agel_e2e_showroom')
    base, srv = serve(REPO / 'index.html')
    site = Path(os.environ.get('AGEL_SITE', '/tmp/agel_site'))
    (site / 'config.js').write_text(
        f"window.AGEL_CONFIG = {{ supabaseUrl: '{HOST}', supabaseAnonKey: '{sb.anon_key}', siteUrl: 'https://agel.example/' }};")
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
        for fn in TESTS:
            if only and only not in fn.__name__: continue
            w = World(browser, base, sb); t0 = time.time()
            try: fn(w); status, info = 'PASS', ''
            except AssertionError as e: status, info = 'FAIL', str(e)
            except Exception as e:
                if os.environ.get('AGEL_DEBUG'): __import__('traceback').print_exc()
                status, info = 'ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:220]}'
            w.close(); results.append(status)
            print(f'{status:5}  {fn.__name__:44} {time.time()-t0:5.1f}s  {info[:300]}', flush=True)
        browser.close()
    srv.shutdown(); sb.stop()
    ok = results.count('PASS')
    print(f'\n{ok}/{len(results)} pruebas del showroom superadas')
    sys.exit(0 if ok == len(results) else 1)

if __name__ == '__main__':
    main()
