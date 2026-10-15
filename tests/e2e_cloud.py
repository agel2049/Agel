#!/usr/bin/env python3
"""
AgelArq — pruebas del modo nube en navegador real contra mini-Supabase
(Postgres + PostgREST reales con todas las migraciones; Auth y Storage
emulados con autorización delegada en las políticas de Postgres).

Uso:
    python3 tests/e2e_cloud.py              # todas
    python3 tests/e2e_cloud.py -k publicar  # filtro
Requiere: Postgres en AGEL_PG y el binario de PostgREST (ver tests/README.md).
"""
import json, os, re, sys, time, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import sync_playwright
from e2e import serve, VENDOR_MAP, VENDOR, FIXTURES, Page, check
from minisupa import MiniSupa

HOST = 'https://agel-pruebas.supabase.co'
PASSWORD = 'clave-segura-123'
TESTS = []
def test(fn): TESTS.append(fn); return fn


def wire_cloud(ctx, sb):
    def cdn(route, request):
        url = request.url
        for key, path in VENDOR_MAP.items():
            if url.endswith(key): return route.fulfill(path=str(path), headers={'access-control-allow-origin': '*'})
        m = re.search(r'@tabler/icons-webfont@[^/]+/(.+)$', url.split('?')[0])
        if m:
            f = VENDOR / '@tabler/icons-webfont' / m.group(1)
            if f.exists(): return route.fulfill(path=str(f))
        return route.abort()
    ctx.route(re.compile(r'https://(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)/.*'), cdn)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, q: r.abort())
    def supa(route, request):
        target = sb.url + request.url[len(HOST):]
        body = None
        if request.method in ('POST', 'PUT') and '/storage/v1/object/' in request.url and not request.post_data_buffer:
            # Playwright no expone el cuerpo de XHR.send(File/Blob). Si el nombre
            # remoto termina en una panorámica de prueba, se reenvía ese archivo.
            m = re.search(r'_(pano_[a-z]+\.jpg)$', request.url)
            if m and (FIXTURES / m.group(1)).exists():
                body = (FIXTURES / m.group(1)).read_bytes()
        try:
            resp = route.fetch(url=target, post_data=body) if body is not None else route.fetch(url=target)
            route.fulfill(response=resp)
        except Exception:
            pass                                  # contexto cerrado con la petición en vuelo
    ctx.route(re.compile(re.escape(HOST) + r'/.*'), supa)


class World:
    def __init__(self, browser, base, sb):
        self.browser, self.base, self.sb = browser, base, sb
        self.ctxs = []

    def page(self, local_mode=False):
        ctx = self.browser.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        if local_mode:
            ctx.add_init_script("try { if (!sessionStorage.getItem('agel.test.gate')) localStorage.setItem('agel.mode', 'local'); } catch (e) {}")
        wire_cloud(ctx, self.sb)
        self.ctxs.append(ctx)
        return Page(ctx, self.base)

    def user(self, name):
        email = f'{name}-{uuid.uuid4().hex[:6]}@prueba.mx'
        self.sb.create_user(email, PASSWORD)
        return email

    def close(self):
        for c in self.ctxs:
            try: c.unroute_all(behavior='ignoreErrors')
            except Exception: pass
            try: c.close()
            except Exception: pass


def login(p, email):
    """Entra por la pantalla de acceso, como un usuario."""
    p.pg.wait_for_selector('.cm-gate', timeout=8000)
    p.pg.fill('.cm-gate input[type=email]', email)
    p.pg.fill('.cm-gate input[type=password]', PASSWORD)
    p.pg.click('.cm-gate button[type=submit]')

def create_org(p, name='Estudio Prueba'):
    p.pg.wait_for_selector('text=Crea tu organización', timeout=8000)
    p.pg.fill('.ag-modal input[type=text]', name)
    p.pg.click('.ag-modal button.primary')

def new_project_via_menu(p, name='Torre Nube'):
    p.pg.wait_for_selector('text=Tu organización aún no tiene proyectos', timeout=8000)
    p.pg.click('.ag-modal button.primary')                 # «Proyecto nuevo»
    p.pg.fill('.ag-modal input[type=text]', name)
    p.pg.click('.ag-modal button.primary')                 # «Crear»
    p.wait("CloudMode.active && PROJ[cP]._cloud && PROJ[cP]._cloud.loaded && PROJ[cP].name === %s" % json.dumps(name), 8000)

def wait_saved(p, timeout=10000):
    p.wait("!CloudMode.pending()", timeout)
    p.ev('CloudMode.syncCurrent()')

def owner_with_project(w, scenes=('pano_a.jpg',), name='Torre Nube'):
    email = w.user('ana'); p = w.page().open()
    login(p, email); create_org(p); new_project_via_menu(p, name)
    for i, fx in enumerate(scenes):
        if i: p.ev("addNewScene()"); p.pg.wait_for_timeout(300)
        p.upload_pano(fx)
        p.wait(f"PROJ[cP].scenes[{i}].localRef && PROJ[cP].scenes[{i}].img",10000)
    wait_saved(p)
    return email, p


@test
def acceso_organizacion_y_primer_proyecto(w):
    email, p = owner_with_project(w)
    pid = p.ev("PROJ[cP]._cloud.id")
    rows = w.sb.sql('select name, pano_url, thumb_url from public.scenes where project_id = %s', (pid,))
    check(len(rows) == 1 and rows[0][1].startswith(HOST + f'/storage/v1/object/public/media/{pid}/pano/'),
          f'la escena no quedó en la base con su panorámica en media/<proyecto>: {rows}')
    check(rows[0][2] and '/thumb/' in rows[0][2], f'la miniatura no se subió: {rows[0][2]}')
    check('Torre Nube' not in (p.ev("localStorage.getItem('agelarq_v4_meta')") or ''), 'el modo nube escribió en los proyectos locales')
    check(not p.errors, f'errores JS: {p.errors}')

@test
def seguir_sin_cuenta(w):
    p = w.page().open()
    p.pg.wait_for_selector('.cm-gate', timeout=8000)
    p.pg.get_by_role('button', name='Seguir sin cuenta, solo en este navegador').click()
    check(not p.ev("CloudMode.active") and p.ev("PROJ[0].name") == 'Torre Mirador', 'no quedó en modo local')
    p.open()
    check(p.pg.locator('.cm-gate').count() == 0, 'volvió a pedir acceso tras elegir modo local')
    check(p.ev("document.getElementById('cmAccount').textContent").strip().endswith('Entrar'), 'falta el botón para entrar después')

@test
def guardado_central_y_recarga(w):
    email, p = owner_with_project(w)
    p.ev("PROJ[cP].scenes[0].name = 'Lobby en la nube'; buildList(); autoSave()")
    wait_saved(p)
    p.open()                                                  # la sesión persiste
    p.wait("CloudMode.active && PROJ[cP]._cloud && PROJ[cP]._cloud.loaded", 10000)
    check(p.ev("PROJ[cP].scenes[0].name") == 'Lobby en la nube', 'el cambio no vino de la base al recargar')
    revs = w.sb.sql('select count(*) from public.project_revisions where project_id = %s', (p.ev("PROJ[cP]._cloud.id"),))[0][0]
    p.ev("selScene(0); autoSave()"); p.pg.wait_for_timeout(1800)
    revs2 = w.sb.sql('select count(*) from public.project_revisions where project_id = %s', (p.ev("PROJ[cP]._cloud.id"),))[0][0]
    check(revs2 == revs, f'navegar sin cambios creó revisiones ({revs} → {revs2})')

@test
def conflicto_no_pisa_trabajo(w):
    email, p1 = owner_with_project(w)
    pid = p1.ev("PROJ[cP]._cloud.id")
    p2 = w.page().open()
    login(p2, email)
    p2.wait("CloudMode.active && PROJ[cP]._cloud && PROJ[cP]._cloud.loaded", 10000)
    p1.ev("PROJ[cP].scenes[0].name = 'Versión de la pestaña 1'; autoSave()"); wait_saved(p1)
    p2.ev("PROJ[cP].scenes[0].name = 'Versión de la pestaña 2'; autoSave()")
    p2.wait('!CloudMode.pending()',10000)
    p2.ev('CloudMode.syncCurrent().catch(()=>{})')
    p2.pg.wait_for_selector('text=Otra persona guardó cambios', timeout=10000)
    name = w.sb.sql('select name from public.scenes where project_id = %s', (pid,))[0][0]
    check(name == 'Versión de la pestaña 1', f'se pisó el trabajo: {name}')
    p2.pg.get_by_role('button', name='Cargar la versión del servidor').click()
    p2.wait("PROJ[cP].scenes[0].name === 'Versión de la pestaña 1'", 8000)

@test
def roles_en_el_editor(w):
    email, p = owner_with_project(w)
    pid = p.ev("PROJ[cP]._cloud.id")
    viewer = w.user('vis'); stranger = w.user('otro')
    p.ev("([pid, mail]) => CloudMode.cloud.rpc('add_project_member', { p_project: pid, p_email: mail, p_role: 'viewer' })", [pid, viewer])
    pv = w.page().open(); login(pv, viewer)
    pv.wait("CloudMode.active && PROJ[cP]._cloud && PROJ[cP]._cloud.loaded", 10000)
    check(pv.ev("PROJ[cP]._cloud.role") == 'viewer', 'rol incorrecto')
    pv.ev("PROJ[cP].scenes[0].name = 'Intento de viewer'; autoSave()"); pv.pg.wait_for_timeout(1800)
    check(w.sb.sql('select name from public.scenes where project_id = %s', (pid,))[0][0] != 'Intento de viewer', 'un viewer guardó cambios')
    check('solo lectura' in pv.ev("document.getElementById('toast').textContent"), 'no se avisó que es solo lectura')
    ps = w.page().open(); login(ps, stranger)
    ps.pg.wait_for_selector('text=Crea tu organización', timeout=8000)
    check(ps.ev("CloudMode.access.projects.length") == 0, 'alguien ajeno ve el proyecto')

@test
def publicar_y_abrir_enlace(w):
    email, p = owner_with_project(w, ('pano_a.jpg', 'pano_b.jpg'))
    p.ev("PROJ[cP].scenes[0].hs.push({ id: AgelCloud.uuid(), type: 'scene', x: 60, y: 50, title: 'Ir', targetScene: 1 }); autoSave()")
    wait_saved(p)
    p.ev("CloudMode.publish()")
    p.pg.wait_for_selector('text=Publicar recorrido', timeout=8000)
    p.pg.click('.ag-modal button.primary')
    p.pg.wait_for_selector('#cmPubUrl', timeout=10000)
    url = p.ev("document.getElementById('cmPubUrl').textContent")
    check('?pub=torre-nube' in url, f'enlace inesperado: {url}')
    c = w.page(local_mode=True)
    c.pg.goto(url.replace(re.match(r'https?://[^/]+/', url).group(0), w.base))
    c.wait("vmPano && vmPano.sphere.material.map && vmScenes.length === 2", 10000)
    check(c.ev("vmScenes[0].hs.some(h => h.type === 'scene' && h.targetScene === 1)"), 'el hotspot de navegación no llegó a la publicación')
    check(c.pg.locator('.cm-gate').count() == 0, 'el cliente vio la pantalla de acceso')
    # Editar sin publicar no cambia lo que ve el cliente
    p.ev("PROJ[cP].scenes[0].name = 'Cambio no publicado'; autoSave()"); wait_saved(p)
    c.pg.reload(); c.wait("vmScenes.length === 2", 10000)
    check(c.ev("vmScenes[0].name") != 'Cambio no publicado', 'un cambio sin publicar llegó al cliente')

@test
def enlace_antiguo_mapeado_abre_publicacion(w):
    email, p = owner_with_project(w, name='Casa Legado')
    p.ev("CloudMode.publish()"); p.pg.wait_for_selector('text=Publicar recorrido', timeout=8000)
    p.pg.click('.ag-modal button.primary'); p.pg.wait_for_selector('#cmPubUrl', timeout=10000)
    pub = w.sb.sql("select id from public.publications where slug = 'casa-legado'")[0][0]
    p.ev("pub => CloudMode.cloud.rpc('map_legacy_link', { p_legacy_id: 'lx9abc', p_kind: 'visor', p_publication: pub })", str(pub))
    c = w.page(local_mode=True).open('?visor=1&id=lx9abc')
    c.wait("vmPano && vmPano.sphere.material.map && vmScenes.length === 1", 10000)
    check(c.ev("vmScenes[0].url").startswith(HOST + '/storage/v1/object/public/media/'), 'no abrió la publicación mapeada')

@test
def direccion_repetida_avisa(w):
    email, p = owner_with_project(w, name='Casa Repetida')
    w.sb.sql("insert into public.publications (project_id, kind, slug) values (%s, 'visor', 'casa-repetida')", (p.ev("PROJ[cP]._cloud.id"),))
    w.sb.sql("delete from public.publications where slug = 'casa-repetida'")
    other = w.sb.sql("select id from public.projects limit 1")[0][0]
    w.sb.sql("insert into public.publications (project_id, kind, slug) values (%s, 'visor', 'casa-repetida')", (other,))
    p.ev("CloudMode.publish()"); p.pg.wait_for_selector('text=Publicar recorrido', timeout=8000)
    p.pg.click('.ag-modal button.primary')
    p.pg.wait_for_selector('.ag-modal .ag-error:has-text("ya está en uso")', timeout=8000)

@test
def importar_proyectos_del_navegador(w):
    # 1) Trabajo previo en modo local: una escena subida al bucket heredado y otra solo en este navegador
    p = w.page(local_mode=True).open()
    p.upload_pano('pano_a.jpg'); p.wait("PROJ[0].scenes[0].img", 10000)
    w.sb.objects[('panoramas','legacy/a.jpg')]=((FIXTURES/'pano_a.jpg').read_bytes(),'image/jpeg')
    p.ev("PROJ[0].scenes[0].supaUrl='"+HOST+"/storage/v1/object/public/panoramas/legacy/a.jpg';saveData()")
    p.ev("""async () => {
        const c = document.createElement('canvas'); c.width = 64; c.height = 32;
        const blob = await new Promise(res => c.toBlob(res, 'image/jpeg'));
        await idbSet('img_0_1', blob);                                   // escena 2: solo en este navegador
        PROJ[0].scenes[0].hs.push({ x: 40, y: 50, title: 'Muestra', details: ['ok'], img: c.toDataURL('image/jpeg') });
        saveData();
    }""")
    # 2) Entrar y traerlo
    email = w.user('imp')
    p.ev("sessionStorage.setItem('agel.test.gate', '1'); localStorage.removeItem('agel.mode')"); p.open()
    login(p, email); create_org(p)
    p.pg.wait_for_selector('text=Importar de este navegador', timeout=8000)
    p.pg.get_by_role('button', name='Importar de este navegador').click()
    p.pg.wait_for_selector('.ag-modal >> text=Torre Mirador', timeout=8000)
    p.ev("document.querySelectorAll('.ag-modal input[type=checkbox]').forEach((c, i) => { c.checked = i === 0; })")
    with p.pg.expect_download() as dl:
        p.pg.click('.ag-modal button.primary')
    check(json.loads(Path(dl.value.path()).read_text())['format'] == 'agelarq-backup', 'no se descargó el respaldo previo')
    p.pg.wait_for_selector('text=Importación terminada', timeout=20000)
    report = p.ev("document.querySelector('.cm-report').innerText")
    check('1 panorámicas ya en la nube' in report and '1 subidas desde este navegador' in report
          and '1 imágenes de hotspots' in report and 'Estacionamiento: sin panorámica' in report, f'reporte inesperado:\n{report}')
    pid = p.ev("PROJ[cP]._cloud.id")
    rows = w.sb.sql('select name, pano_url from public.scenes where project_id = %s order by position', (pid,))
    check(len(rows) == 3 and rows[1][1] and f'/media/{pid}/pano/' in rows[1][1], f'escenas importadas: {rows}')
    check(json.loads(p.ev("localStorage.getItem('agelarq_v4_meta')"))['proj'][0]['name'] == 'Torre Mirador', 'se tocaron los datos locales')

@test
def enlace_por_correo_y_sesion_renovada(w):
    email = w.user('magic')
    w.sb.token_ttl = 20                                    # vence pronto: debe renovarse sola
    p = w.page().open()
    p.pg.wait_for_selector('.cm-gate', timeout=8000)
    p.pg.fill('.cm-gate input[type=email]', email)
    p.pg.get_by_role('button', name='Enviarme un enlace de acceso').click()
    p.pg.wait_for_selector('text=Te enviamos un enlace', timeout=8000)
    link = w.sb.magic_links[email.lower()]
    p.pg.goto('about:blank')                              # el correo abre una carga nueva, no un cambio de #
    p.pg.goto(w.base + link[link.index('#'):])
    p.wait("!document.getElementById('intro')", 8000)
    p.pg.wait_for_selector('text=Crea tu organización', timeout=8000)
    check(p.ev("location.hash") == '', 'el token quedó visible en la dirección')
    create_org(p)
    p.pg.wait_for_selector('text=Tu organización aún no tiene proyectos', timeout=8000)
    check(any(path == '/auth/v1/token' for _, path in w.sb.requests), 'la sesión no se renovó')
    w.sb.token_ttl = 3600


def main():
    only = sys.argv[sys.argv.index('-k') + 1] if '-k' in sys.argv else None
    sb = MiniSupa.start('agel_e2e_cloud')
    app = Path(__file__).resolve().parent.parent / 'index.html'
    base, srv = serve(app)
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
            except Exception as e: status, info = 'ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:220]}'
            w.close(); results.append(status)
            print(f'{status:5}  {fn.__name__:44} {time.time()-t0:5.1f}s  {info[:220]}', flush=True)
        browser.close()
    srv.shutdown(); sb.stop()
    ok = results.count('PASS')
    print(f'\n{ok}/{len(results)} pruebas del modo nube superadas')
    sys.exit(0 if ok == len(results) else 1)

if __name__ == '__main__':
    main()
