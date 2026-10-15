#!/usr/bin/env python3
"""
AgelArq — pruebas de permisos y datos sobre Postgres real.

Crea una base vacía, aplica emulation.sql (piezas de Supabase) y TODAS las
migraciones de supabase/migrations en orden, y luego ejecuta cada prueba
actuando como visitante (anon), usuario A, usuario B, etc. Las políticas
que se evalúan son las mismas que correrán en tu proyecto.

Uso:
    python3 supabase/tests/run.py                 # todas
    python3 supabase/tests/run.py -k leads        # filtro por nombre
Variables:
    AGEL_PG   cadena de conexión al servidor (por defecto host=/tmp port=54329 user=postgres)
"""
import json, os, sys, time, traceback, uuid
from pathlib import Path
import psycopg
from psycopg import errors

HERE = Path(__file__).resolve().parent
MIGRATIONS = sorted((HERE.parent / 'migrations').glob('*.sql'))
SERVER = os.environ.get('AGEL_PG', 'host=/tmp port=54329 user=postgres')
DB = os.environ.get('AGEL_TEST_DB', 'agel_test')

TESTS = []
def test(fn): TESTS.append(fn); return fn
def check(cond, msg):
    if not cond: raise AssertionError(msg)

# ───────────────────────── base de datos ─────────────────────────
def fresh_db():
    with psycopg.connect(SERVER + ' dbname=postgres', autocommit=True) as c:
        c.execute(f'drop database if exists {DB} with (force)')
        c.execute(f'create database {DB}')
    conn = psycopg.connect(SERVER + f' dbname={DB}', autocommit=True)
    conn.execute((HERE / 'emulation.sql').read_text())
    for m in MIGRATIONS:
        try:
            conn.execute(m.read_text())
        except Exception as e:
            raise SystemExit(f'La migración {m.name} falló: {e}')
    return conn

class World:
    """Usuarios de prueba y forma de actuar como cada uno."""
    def __init__(self, conn):
        self.conn = conn
        self.users = {}

    def user(self, name):
        if name not in self.users:
            uid = str(uuid.uuid4())
            self.conn.execute('insert into auth.users (id, email) values (%s, %s)', (uid, f'{name}@prueba.mx'))
            self.users[name] = uid
        return self.users[name]

    def run(self, who, sql, params=None, fetch='all'):
        """Ejecuta sql como `who` ('anon', 'service' o nombre de usuario) en una transacción."""
        with self.conn.transaction():
            cur = self.conn.cursor()
            if who == 'service':
                cur.execute("set local role service_role")
                cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'role': 'service_role'}),))
            elif who == 'anon':
                cur.execute("set local role anon")
                cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'role': 'anon'}),))
            else:
                uid = self.user(who)
                cur.execute("set local role authenticated")
                cur.execute("select set_config('request.jwt.claims', %s, true)",
                            (json.dumps({'sub': uid, 'role': 'authenticated', 'email': f'{who}@prueba.mx'}),))
            cur.execute(sql, params)
            if fetch == 'one':  return cur.fetchone()
            if fetch == 'val':  r = cur.fetchone(); return r[0] if r else None
            if fetch == 'none': return cur.rowcount
            return cur.fetchall() if cur.description else cur.rowcount

    DENIALS = (errors.InsufficientPrivilege, errors.RaiseException, errors.CheckViolation,
               errors.InvalidAuthorizationSpecification, errors.NoDataFound, errors.UndefinedFunction,
               errors.ForeignKeyViolation, errors.NotNullViolation)

    def denied(self, who, sql, params=None):
        """True si Postgres rechaza la operación o no afecta filas."""
        try:
            return self.run(who, sql, params, fetch='none') == 0
        except psycopg.Error as e:
            if isinstance(e, self.DENIALS) or getattr(e, 'sqlstate', '') == 'PT409':
                return True
            raise

    # Atajos de escenario
    def org(self, owner, name='Org'):
        return self.run(owner, 'select public.create_organization(%s)', (name,), fetch='val')

    def project(self, who, org, name='Proyecto'):
        return self.run(who, 'select public.create_project(%s, %s)', (org, name), fetch='val')

    def add_member(self, who, project, member, role):
        self.user(member)
        return self.run(who, 'select public.add_project_member(%s, %s, %s)',
                        (project, f'{member}@prueba.mx', role), fetch='val')

    def obj(self, who, bucket, name, size=1000):
        return self.run(who, 'insert into storage.objects (bucket_id, name, owner, metadata) values (%s, %s, auth.uid(), %s)',
                        (bucket, name, json.dumps({'size': size})), fetch='none')

    def upload(self, who, project, bucket='media', kind='pano', filename='a.jpg', size=1000):
        """Reserva (como hace la app) y sube. Devuelve la ruta."""
        r = self.run(who, 'select public.reserve_upload(%s, %s, %s, %s, %s)', (project, bucket, kind, filename, size), fetch='val')
        assert self.obj(who, bucket, r['path'], size) == 1
        return r['path']

# ───────────────────────── Fase 1: acceso ─────────────────────────
@test
def visitante_no_ve_ni_escribe_nada(w):
    org = w.org('ana'); p = w.project('ana', org)
    check(w.run('anon', 'select count(*) from public.projects', fetch='val') == 0
          if not w.denied('anon', 'select 1 from public.projects') else True, 'anon ve proyectos')
    check(w.denied('anon', "insert into public.projects (org_id, name) values (%s, 'x')", (org,)), 'anon crea proyectos')
    check(w.denied('anon', 'select public.create_project(%s, %s)', (org, 'x')), 'anon crea proyectos por RPC')
    check(w.denied('anon', 'select public.create_organization(%s)', ('x',)), 'anon crea organizaciones')
    check(w.denied('anon', 'update public.projects set name = %s', ('hack',)), 'anon modifica proyectos')

@test
def iniciar_sesion_no_da_acceso_a_otros(w):
    org_a = w.org('ana'); pa = w.project('ana', org_a, 'Privado de Ana')
    w.user('beto')
    check(w.run('beto', 'select count(*) from public.projects', fetch='val') == 0, 'B ve el proyecto de A')
    check(w.run('beto', 'select count(*) from public.organizations', fetch='val') == 0, 'B ve la organización de A')
    check(w.denied('beto', 'update public.projects set name = %s where id = %s', ('hack', pa)), 'B modifica a A')
    check(w.denied('beto', 'delete from public.projects where id = %s', (pa,)), 'B borra a A')
    check(w.denied('beto', 'select public.create_project(%s, %s)', (org_a, 'x')), 'B crea proyectos en la organización de A')
    check(w.denied('beto', "insert into public.projects (org_id, name, created_by) values (%s, 'x', %s)",
                   (org_a, w.user('beto'))), 'B inserta directo en la organización de A')
    check(w.denied('beto', "insert into public.memberships (org_id, user_id, role) values (%s, %s, 'owner')",
                   (org_a, w.user('beto'))), 'B se agrega solo como owner')

@test
def propietario_completa_su_flujo(w):
    org = w.org('ana'); p = w.project('ana', org, 'Torre')
    check(w.run('ana', 'select role from public.project_members where project_id = %s', (p,), fetch='val') == 'owner',
          'el creador no quedó como owner')
    check(w.run('ana', 'update public.projects set name = %s where id = %s', ('Torre 2', p), fetch='none') == 1,
          'el owner no puede editar')
    access = w.run('ana', 'select public.my_access()', fetch='val')
    check(len(access['projects']) == 1 and access['projects'][0]['role'] == 'owner', f'my_access incorrecto: {access}')

@test
def miembro_de_organizacion_solo_ve_proyectos_asignados(w):
    org = w.org('ana'); p1 = w.project('ana', org, 'Uno'); p2 = w.project('ana', org, 'Dos')
    w.add_member('ana', p1, 'carla', 'editor')
    vis = [r[0] for r in w.run('carla', 'select name from public.projects order by name')]
    check(vis == ['Uno'], f'la miembro ve proyectos no asignados: {vis}')
    check(w.denied('carla', 'update public.projects set name = %s where id = %s', ('x', p2)), 'edita uno no asignado')

@test
def roles_de_proyecto(w):
    org = w.org('ana'); p = w.project('ana', org)
    w.add_member('ana', p, 'edi', 'editor'); w.add_member('ana', p, 'rev', 'reviewer'); w.add_member('ana', p, 'vis', 'viewer')
    check(w.run('edi', 'update public.projects set subtitle = %s where id = %s', ('ok', p), fetch='none') == 1, 'editor no edita')
    check(w.denied('rev', 'update public.projects set subtitle = %s where id = %s', ('x', p)), 'reviewer edita')
    check(w.denied('vis', 'update public.projects set subtitle = %s where id = %s', ('x', p)), 'viewer edita')
    check(w.run('vis', 'select count(*) from public.projects where id = %s', (p,), fetch='val') == 1, 'viewer no lee')
    check(w.denied('edi', 'delete from public.projects where id = %s', (p,)), 'editor borra el proyecto')
    check(w.denied('edi', 'select public.add_project_member(%s, %s, %s)', (p, 'vis@prueba.mx', 'owner')),
          'editor se otorga/otorga owner')
    check(w.denied('vis', "update public.project_members set role = 'owner' where project_id = %s and user_id = auth.uid()", (p,)),
          'viewer se asciende a owner')

@test
def admin_de_organizacion_administra_todo(w):
    org = w.org('ana'); p = w.project('ana', org)
    w.user('dani')
    w.run('ana', "insert into public.memberships (org_id, user_id, role) values (%s, %s, 'admin')", (org, w.user('dani')))
    check(w.run('dani', 'update public.projects set name = %s where id = %s', ('Admin', p), fetch='none') == 1,
          'el admin no administra los proyectos')
    check(w.denied('dani', "update public.memberships set role = 'owner' where org_id = %s and user_id = auth.uid()", (org,)),
          'el admin se convierte en owner')

@test
def organizacion_no_queda_sin_propietario(w):
    org = w.org('ana')
    check(w.denied('ana', 'delete from public.memberships where org_id = %s and user_id = auth.uid()', (org,)),
          'el único owner pudo salir')
    check(w.run('ana', 'delete from public.organizations where id = %s', (org,), fetch='none') == 1,
          'borrar la organización completa falló')

@test
def proyecto_no_cambia_de_organizacion(w):
    org1 = w.org('ana', 'Uno'); org2 = w.org('ana', 'Dos'); p = w.project('ana', org1)
    check(w.denied('ana', 'update public.projects set org_id = %s where id = %s', (org2, p)), 'el proyecto cambió de organización')

@test
def agregar_correo_inexistente_falla_con_mensaje(w):
    org = w.org('ana'); p = w.project('ana', org)
    try:
        w.run('ana', 'select public.add_project_member(%s, %s, %s)', (p, 'nadie@x.mx', 'viewer'))
        raise AssertionError('no falló')
    except errors.NoDataFound as e:
        check('No existe una cuenta' in str(e), str(e))

# ───────────────────────── Fase 1: Storage ─────────────────────────
@test
def storage_por_proyecto(w):
    org = w.org('ana'); p = w.project('ana', org)
    w.add_member('ana', p, 'vis', 'viewer'); w.user('beto')
    path = w.upload('ana', p)
    check(w.denied('beto', "insert into storage.objects (bucket_id, name) values ('media', %s)", (f'{p}/panos/x.jpg',)),
          'B sube a un proyecto ajeno')
    check(w.denied('vis', "insert into storage.objects (bucket_id, name) values ('media', %s)", (f'{p}/panos/x.jpg',)),
          'un viewer sube archivos')
    check(w.denied('anon', "insert into storage.objects (bucket_id, name) values ('media', %s)", (f'{p}/panos/x.jpg',)),
          'anon sube a media')
    check(w.denied('ana', "insert into storage.objects (bucket_id, name) values ('media', 'sin-proyecto/a.jpg')"),
          'se aceptó una ruta sin id de proyecto')
    check(w.denied('beto', "select public.reserve_upload(%s, 'media', 'pano', 'x.jpg', 10)", (p,)), 'B reserva en un proyecto ajeno')
    check(w.denied('beto', "delete from storage.objects where bucket_id = 'media' and name = %s", (path,)),
          'B borra archivos de A')
    check(w.denied('beto', "update storage.objects set name = name where bucket_id = 'media' and name = %s", (path,)),
          'B sobrescribe (upsert) archivos de A')
    check(w.denied('ana', "update storage.objects set metadata = '{}' where bucket_id = 'media' and name = %s",
                (path,)), 'el owner sobrescribe un archivo sin nueva reserva')

@test
def storage_tecnico_privado(w):
    org = w.org('ana'); p = w.project('ana', org)
    w.add_member('ana', p, 'rev', 'reviewer'); w.user('beto')
    w.upload('ana', p, 'technical', 'nwd', 'modelo.nwd')
    check(w.run('rev', "select count(*) from storage.objects where bucket_id = 'technical'", fetch='val') == 1,
          'un reviewer no lee archivos técnicos de su proyecto')
    check(w.run('beto', "select count(*) from storage.objects where bucket_id = 'technical'", fetch='val') == 0,
          'B lee archivos técnicos de A')
    check(w.run('anon', "select count(*) from storage.objects where bucket_id = 'technical'", fetch='val') == 0,
          'anon lee archivos técnicos')

@test
def storage_legado_sin_cambios(w):
    # Las políticas actuales del bucket panoramas siguen igual hasta que tú lo decidas.
    check(w.obj('anon', 'panoramas', 'legacy.jpg') == 1, 'se rompió la subida actual al bucket panoramas')
    check(w.denied('anon', "delete from storage.objects where bucket_id = 'panoramas' and name = 'legacy.jpg'"),
          'el bucket panoramas permite borrar')

# ───────────────────────── Fase 2: contenido central ─────────────────────────
SUPA = 'https://ejemplo.supabase.co/storage/v1/object/public/media'

def tree(project, n=2, target=True):
    sids = [str(uuid.uuid4()) for _ in range(n)]
    scenes = []
    for i, sid in enumerate(sids):
        hs = [{'id': str(uuid.uuid4()), 'type': 'info', 'x': 40, 'y': 50, 'title': f'Piso {i}', 'details': ['Mármol 60×60, pulido', 'Junta 3 mm']}]
        if target and n > 1:
            hs.append({'id': str(uuid.uuid4()), 'type': 'scene', 'x': 60, 'y': 50, 'title': 'Ir', 'target_scene_id': sids[(i + 1) % n]})
        scenes.append({'id': sid, 'name': f'Escena {i}', 'meta': 'PB', 'pano_url': f'{SUPA}/{project}/pano/{i}.jpg', 'hs': hs})
    return {'project': {'name': 'Torre'}, 'scenes': scenes}

def save(w, who, p, t, base):
    return w.run(who, 'select public.save_project_tree(%s, %s, %s)', (p, json.dumps(t), base), fetch='val')

@test
def guardar_y_leer_arbol(w):
    org = w.org('ana'); p = w.project('ana', org)
    t = tree(p)
    r = save(w, 'ana', p, t, 0)
    check(r['revision'] == 1, f'revisión inesperada {r}')
    got = w.run('ana', 'select public.load_project_tree(%s)', (p,), fetch='val')
    check([s['name'] for s in got['scenes']] == ['Escena 0', 'Escena 1'], 'escenas no coinciden')
    hs = got['scenes'][0]['hs']
    check(hs[0]['details'] == ['Mármol 60×60, pulido', 'Junta 3 mm'], f'detalles alterados: {hs[0]["details"]}')
    check(hs[1]['type'] == 'scene' and hs[1]['target_scene_id'] == t['scenes'][1]['id'], 'destino del hotspot perdido')
    check(w.run('ana', 'select count(*) from public.project_revisions where project_id = %s', (p,), fetch='val') == 1, 'sin historial')
    # Segundo guardado: quitar una escena borra también sus hotspots
    t2 = {'project': {}, 'scenes': [t['scenes'][0]]}
    t2['scenes'][0]['hs'] = [h for h in t2['scenes'][0]['hs'] if h['type'] == 'info']
    check(save(w, 'ana', p, t2, 1)['revision'] == 2, 'segundo guardado falló')
    check(w.run('ana', 'select count(*) from public.hotspots where project_id = %s', (p,), fetch='val') == 1, 'quedaron hotspots huérfanos')

@test
def conflicto_no_pisa_trabajo_ajeno(w):
    org = w.org('ana'); p = w.project('ana', org); w.add_member('ana', p, 'edi', 'editor')
    save(w, 'ana', p, tree(p), 0)
    try:
        save(w, 'edi', p, tree(p, 1), 0)             # copia vieja
        raise AssertionError('se aceptó un guardado con revisión vieja')
    except psycopg.Error as e:
        check(e.sqlstate == 'PT409' and 'Conflicto' in str(e), f'{e.sqlstate}: {e}')
    check(len(w.run('ana', 'select public.load_project_tree(%s)', (p,), fetch='val')['scenes']) == 2, 'se pisó el trabajo')

@test
def guardar_requiere_rol_de_edicion(w):
    org = w.org('ana'); p = w.project('ana', org)
    w.add_member('ana', p, 'vis', 'viewer'); w.add_member('ana', p, 'rev', 'reviewer'); w.user('beto')
    for who in ('vis', 'rev', 'beto', 'anon'):
        check(w.denied(who, 'select public.save_project_tree(%s, %s, %s)', (p, json.dumps(tree(p)), 0)), f'{who} guardó')
    check(w.denied('beto', 'select public.load_project_tree(%s)', (p,)), 'B leyó el árbol de A')

@test
def no_se_secuestran_escenas_de_otro_proyecto(w):
    org_a = w.org('ana'); pa = w.project('ana', org_a)
    org_b = w.org('beto'); pb = w.project('beto', org_b)
    tb = tree(pb); save(w, 'beto', pb, tb, 0)
    evil = tree(pa); evil['scenes'][0]['id'] = tb['scenes'][0]['id']
    check(w.denied('ana', 'select public.save_project_tree(%s, %s, %s)', (pa, json.dumps(evil), 0)), 'A reutilizó ids de B')
    check(w.run('beto', 'select name from public.scenes where id = %s', (tb['scenes'][0]['id'],), fetch='val') == 'Escena 0',
          'la escena de B cambió')

@test
def arbol_invalido_se_rechaza(w):
    org = w.org('ana'); p = w.project('ana', org)
    big = {'scenes': [{'id': str(uuid.uuid4()), 'name': 'x', 'hs': []} for _ in range(201)]}
    check(w.denied('ana', 'select public.save_project_tree(%s, %s, %s)', (p, json.dumps(big), 0)), 'aceptó 201 escenas')
    bad = tree(p); bad['scenes'][0]['pano_url'] = 'javascript:alert(1)'
    check(w.denied('ana', 'select public.save_project_tree(%s, %s, %s)', (p, json.dumps(bad), 0)), 'aceptó URL javascript:')
    bad2 = tree(p); bad2['scenes'][0]['hs'][0]['img_url'] = 'data:text/html,<script>'
    check(w.denied('ana', 'select public.save_project_tree(%s, %s, %s)', (p, json.dumps(bad2), 0)), 'aceptó data:text/html')

@test
def restaurar_revision(w):
    org = w.org('ana'); p = w.project('ana', org)
    save(w, 'ana', p, tree(p, 3), 0)
    save(w, 'ana', p, tree(p, 1), 1)
    r = w.run('ana', 'select public.restore_project_revision(%s, 1)', (p,), fetch='val')
    check(r['revision'] == 3, f'{r}')
    check(len(w.run('ana', 'select public.load_project_tree(%s)', (p,), fetch='val')['scenes']) == 3, 'no se restauró')

@test
def subidas_reservadas_y_cuota(w):
    org = w.org('ana'); p = w.project('ana', org); w.add_member('ana', p, 'vis', 'viewer')
    r = w.run('ana', "select public.reserve_upload(%s, 'media', 'pano', 'Sala Ñandú.JPG', 1000, 'image/jpeg')", (p,), fetch='val')
    check(r['path'].startswith(f'{p}/pano/') and r['path'].endswith('_sala_nandu.jpg'), f'ruta inesperada: {r["path"]}')
    check(w.obj('ana', 'media', r['path']) == 1, 'no se pudo subir a la ruta reservada')
    check(w.denied('ana', "insert into storage.objects (bucket_id, name) values ('media', %s)", (f'{p}/pano/no_reservada.jpg',)),
          'Storage aceptó una ruta sin reservar')
    check(w.denied('vis', "select public.reserve_upload(%s, 'media', 'pano', 'x.jpg', 10)", (p,)), 'un viewer reservó')
    w.run('ana', 'select public.complete_upload(%s, 2048, 1024)', (r['asset_id'],))
    w.conn.execute('update public.organizations set quota_bytes = 1500 where id = %s', (org,))
    try:
        w.run('ana', "select public.reserve_upload(%s, 'media', 'pano', 'b.jpg', 1000)", (p,))
        raise AssertionError('se excedió la cuota')
    except errors.ConfigurationLimitExceeded as e:
        check('Cuota' in str(e), str(e))

# Seguridad del registro de archivos y margen del plan gratuito.
@test
def cuota_no_se_puede_falsear_desde_el_cliente(w):
    org = w.org('ana'); p = w.project('ana', org)
    check(w.denied('ana', "insert into public.assets(project_id,bucket,path,kind,bytes) values (%s,'media',%s,'pano',0)",
                   (p, f'{p}/pano/falso.jpg')), 'editor puede crear una reserva con cero bytes')
    r = w.run('ana', "select reserve_upload(%s,'media','pano','a.jpg',1)", (p,), fetch='val')
    check(w.denied('ana', "update public.assets set bytes=0,status='archived' where id=%s", (r['asset_id'],)), 'editor altera consumo')
    check(w.denied('ana', "delete from public.assets where id=%s", (r['asset_id'],)), 'editor borra consumo')
    cap = w.conn.execute("select file_size_limit from storage.buckets where id='media'").fetchone()[0]
    check(w.run('ana','select app.org_used_bytes(%s)',(org,),fetch='val') >= cap, 'la reserva confía en el tamaño declarado')

@test
def complete_exige_objeto_real_y_permiso(w):
    org = w.org('ana'); p = w.project('ana', org); w.user('beto')
    r = w.run('ana', "select reserve_upload(%s,'media','pano','a.jpg',1000)",(p,),fetch='val')
    check(w.denied('ana','select complete_upload(%s)',(r['asset_id'],)), 'completa sin archivo real')
    w.obj('ana','media',r['path'])
    check(w.denied('beto','select complete_upload(%s)',(r['asset_id'],)), 'B completa archivo ajeno')
    w.run('ana','select complete_upload(%s)',(r['asset_id'],))
    check(w.denied('ana', "update storage.objects set metadata='{}' where bucket_id='media' and name=%s",(r['path'],)), 'sobrescribe archivo completado')
    check(w.denied('ana','delete from public.projects where id=%s',(p,)), 'borra el registro sin borrar el archivo')

@test
def presupuesto_global_incluye_archivos_heredados(w):
    org = w.org('ana'); p = w.project('ana', org)
    w.conn.execute("insert into storage.objects(bucket_id,name,metadata) values ('panoramas','heredado.jpg','{\"size\":790000000}')")
    try:
        w.run('ana', "select reserve_upload(%s,'media','pano','a.jpg',1)",(p,))
        raise AssertionError('permite exceder el margen global gratuito')
    except errors.ConfigurationLimitExceeded: pass

# ───────────────────────── publicaciones ─────────────────────────
def published(w, owner, p, kind='visor', slug='torre-mirador'):
    pub = w.run(owner, 'select public.create_publication(%s, %s, %s, %s)', (p, kind, slug, 'Torre'), fetch='val')
    v = w.run(owner, 'select public.create_publication_version(%s, %s)', (pub, 'primera'), fetch='val')
    w.run(owner, 'select public.publish_version(%s)', (v,))
    return pub, v

@test
def flujo_de_publicacion(w):
    org = w.org('ana'); p = w.project('ana', org); w.add_member('ana', p, 'edi', 'editor')
    save(w, 'ana', p, tree(p), 0)
    pub = w.run('edi', "select public.create_publication(%s, 'visor', 'torre', 'Torre')", (p,), fetch='val')
    v1 = w.run('edi', "select public.create_publication_version(%s, 'v1')", (pub,), fetch='val')
    check(w.run('anon', "select public.get_publication('torre')", fetch='val') is None, 'un borrador es público')
    check(w.denied('edi', 'select public.publish_version(%s)', (v1,)), 'un editor publicó sin aprobación')
    w.run('edi', 'select public.request_review(%s)', (pub,))
    w.run('ana', 'select public.publish_version(%s)', (v1,))
    g = w.run('anon', "select public.get_publication('torre')", fetch='val')
    check(g and g['version'] == 1 and len(g['snapshot']['scenes']) == 2, f'publicación incorrecta: {g and g["version"]}')
    hs = g['snapshot']['scenes'][0]['hs']
    check(any(h['type'] == 'scene' and h['targetScene'] == 1 for h in hs), 'el destino no se tradujo a índice')
    # Editar el proyecto NO cambia lo publicado
    save(w, 'ana', p, tree(p, 1), 1)
    check(len(w.run('anon', "select public.get_publication('torre')", fetch='val')['snapshot']['scenes']) == 2,
          'editar alteró lo publicado')
    v2 = w.run('edi', "select public.create_publication_version(%s, 'v2')", (pub,), fetch='val')
    w.run('ana', 'select public.publish_version(%s)', (v2,))
    check(w.run('anon', "select public.get_publication('torre')", fetch='val')['version'] == 2, 'no se publicó v2')
    w.run('ana', 'select public.rollback_publication(%s, 1)', (pub,))
    g = w.run('anon', "select public.get_publication('torre')", fetch='val')
    check(g['version'] == 1 and len(g['snapshot']['scenes']) == 2, 'volver atrás no restauró v1')
    w.run('ana', 'select public.archive_publication(%s)', (pub,))
    check(w.run('anon', "select public.get_publication('torre')", fetch='val') is None, 'archivada sigue pública')

@test
def estado_de_publicacion_solo_por_acciones(w):
    org = w.org('ana'); p = w.project('ana', org); w.add_member('ana', p, 'edi', 'editor')
    save(w, 'ana', p, tree(p), 0)
    pub = w.run('ana', "select public.create_publication(%s, 'visor', 'torre', '')", (p,), fetch='val')
    check(w.denied('edi', "update public.publications set status = 'published' where id = %s", (pub,)), 'estado cambiado directo')
    check(w.run('edi', "update public.publications set title = 'Nuevo' where id = %s", (pub,), fetch='none') == 1,
          'el editor no puede cambiar el título')
    check(w.denied('edi', "insert into public.publication_versions (publication_id, project_id, version, snapshot) values (%s, %s, 9, '{}')",
                   (pub, p)), 'versión insertada a mano')
    check(w.denied('beto', "select public.create_publication(%s, 'visor', 'robo', '')", (p,)), 'B publicó el proyecto de A')

@test
def snapshot_sin_datos_privados(w):
    org = w.org('ana'); p = w.project('ana', org)
    save(w, 'ana', p, tree(p), 0)
    w.run('ana', """update public.projects set showroom = '{"description":"Hola","notify_email":"secreto@x.mx","webhook":"https://x"}' where id = %s""", (p,))
    w.run('ana', "insert into public.spaces (project_id, kind, name, price, show_price) values (%s, 'unidad', 'A-101', 4500000, false)", (p,))
    w.run('ana', "insert into public.spaces (project_id, kind, name, price, show_price) values (%s, 'unidad', 'A-102', 5100000, true)", (p,))
    published(w, 'ana', p, 'showroom', 'torre-venta')
    snap = json.dumps(w.run('anon', "select public.get_publication('torre-venta')", fetch='val'))
    check('secreto@x.mx' not in snap and 'webhook' not in snap, 'datos internos en el snapshot')
    check('4500000' not in snap, 'precio oculto publicado')
    check('5100000' in snap, 'falta el precio visible')
    check(w.user('ana') not in snap, 'ids de usuarios en el snapshot')

@test
def bim_no_es_publico(w):
    org = w.org('ana'); p = w.project('ana', org); save(w, 'ana', p, tree(p), 0)
    published(w, 'ana', p, 'bim', 'tecnico-torre')
    check(w.run('anon', "select public.get_publication('tecnico-torre')", fetch='val') is None, 'BIM publicado al público')

@test
def enlaces_antiguos(w):
    org = w.org('ana'); p = w.project('ana', org); save(w, 'ana', p, tree(p), 0)
    pub, _ = published(w, 'ana', p)
    w.run('ana', "select public.map_legacy_link('lxk2a9ab', 'visor', %s)", (pub,))
    check(w.run('anon', "select public.resolve_legacy_link('lxk2a9ab', 'visor')", fetch='val') == 'torre-mirador', 'no resolvió')
    check(w.run('anon', "select public.resolve_legacy_link('lxk2a9ab', 'modelo')", fetch='val') is None, 'resolvió otro tipo')
    check(w.denied('beto', "select public.map_legacy_link('robado', 'visor', %s)", (pub,)), 'B mapeó enlaces de A')

# ───────────────────────── Fase 3: catálogo y prospectos ─────────────────────────
def showroom(w):
    org = w.org('ana'); p = w.project('ana', org)
    save(w, 'ana', p, tree(p), 0)
    u = w.run('ana', "insert into public.spaces (project_id, kind, name, code, availability) values (%s, 'unidad', 'Depto', 'A-101', 'disponible') returning id", (p,), fetch='val')
    published(w, 'ana', p, 'showroom', 'torre')
    return org, p, u

def lead(w, who='anon', slug='torre', space=None, email='cliente@correo.mx', consent=True, name='Cliente'):
    return w.run(who, 'select public.submit_lead(%s, %s, %s, %s, %s, %s, %s, %s)',
                 (slug, space, name, email, '+52 443 000 0000', 'Me interesa', consent,
                  json.dumps({'utm_source': 'instagram', 'path': '/p/torre', 'evil': 'x' * 5000})), fetch='val')

@test
def prospecto_con_contexto(w):
    org, p, u = showroom(w); w.add_member('ana', p, 'vis', 'viewer')
    lid = lead(w, space=u)
    row = w.run('ana', 'select space_label, source, status from public.leads where id = %s', (lid,), fetch='one')
    check(row[0] == 'Depto · A-101' and row[1]['utm_source'] == 'instagram' and 'evil' not in row[1], f'contexto incorrecto: {row}')
    check(w.run('vis', 'select count(*) from public.leads', fetch='val') == 0, 'un viewer ve datos personales')
    check(w.denied('anon', 'select 1 from public.leads'), 'anon lee prospectos')
    check(w.run('beto', 'select count(*) from public.leads', fetch='val') == 0, 'B ve prospectos de A')

@test
def prospecto_validaciones(w):
    org, p, u = showroom(w)
    org2 = w.org('beto'); p2 = w.project('beto', org2)
    u2 = w.run('beto', "insert into public.spaces (project_id, kind, name) values (%s, 'unidad', 'Ajena') returning id", (p2,), fetch='val')
    for desc, kwargs in [('sin autorización', {'consent': False}), ('correo inválido', {'email': 'no-es-correo'}),
                         ('unidad de otro proyecto', {'space': u2}), ('publicación inexistente', {'slug': 'nada'}),
                         ('nombre vacío', {'name': ' '})]:
        check(w.denied('anon', 'select public.submit_lead(%s, %s, %s, %s, %s, %s, %s, %s)',
                       (kwargs.get('slug', 'torre'), kwargs.get('space'), kwargs.get('name', 'Cliente'),
                        kwargs.get('email', 'c@correo.mx'), '', '', kwargs.get('consent', True), '{}')), f'aceptó: {desc}')
    for _ in range(3): lead(w, email='repite@correo.mx')
    try:
        lead(w, email='repite@correo.mx'); raise AssertionError('sin límite de frecuencia')
    except errors.ConfigurationLimitExceeded:
        pass

@test
def datos_del_visitante_no_se_reescriben(w):
    org, p, u = showroom(w)
    lid = lead(w)
    check(w.denied('ana', "update public.leads set email = 'otro@x.mx' where id = %s", (lid,)), 'se reescribió el correo')
    check(w.run('ana', "update public.leads set status = 'contactado', notes = 'llamado' where id = %s", (lid,), fetch='none') == 1,
          'no se pudo dar seguimiento')

@test
def catalogo_registra_quien_cambia_precio(w):
    org = w.org('ana'); p = w.project('ana', org); w.add_member('ana', p, 'edi', 'editor')
    u = w.run('ana', "insert into public.spaces (project_id, kind, name, price) values (%s, 'unidad', 'A', 100) returning id", (p,), fetch='val')
    w.run('edi', "update public.spaces set price = 120 where id = %s", (u,))
    check(w.run('ana', 'select price_updated_by from public.spaces where id = %s', (u,), fetch='val') == uuid.UUID(w.user('edi')),
          'no se registró quién cambió el precio')
    check(w.denied('beto', "update public.spaces set price = 1 where id = %s", (u,)), 'B cambió precios de A')

# ───────────────────────── Fase 4: BIM ─────────────────────────
def model(w, owner, p):
    m = w.run(owner, "insert into public.models (project_id, name) values (%s, 'Torre MEP') returning id", (p,), fetch='val')
    v = w.run(owner, "select public.create_model_version(%s, 'v1', 'torre.nwd', 1000)", (m,), fetch='val')
    return m, v['id']

@test
def estado_de_conversion_solo_servidor(w):
    org = w.org('ana'); p = w.project('ana', org)
    m, v = model(w, 'ana', p)
    check(w.denied('ana', "update public.model_versions set status = 'ready', aps_urn = 'abc' where id = %s", (v,)),
          'la app marcó la conversión como lista')
    check(w.run('service', "update public.model_versions set status = 'ready', aps_urn = 'dXJuOmFi' where id = %s", (v,), fetch='none') == 1,
          'el servidor no pudo actualizar el estado')
    check(w.run('beto', 'select count(*) from public.models', fetch='val') == 0, 'B ve modelos de A')

@test
def correspondencias_y_sin_clasificar(w):
    org = w.org('ana'); p = w.project('ana', org); m, v = model(w, 'ana', p)
    rows = [{'source_id': 'u-1', 'dbid': 10, 'discipline': 'Mecánica', 'system': 'HVAC', 'classification': 'propiedad'},
            {'source_id': 'u-2', 'dbid': 11, 'discipline': 'Eléctrica', 'classification': 'regla'},
            {'source_id': 'u-3', 'dbid': 12}]
    check(w.run('ana', 'select public.upsert_element_mappings(%s, %s)', (v, json.dumps(rows)), fetch='val') == 3, 'no se guardaron')
    f = w.run('ana', 'select public.model_facets(%s)', (v,), fetch='val')
    check(f['total'] == 3 and f['sin_clasificar'] == 1 and f['discipline'].get('sin clasificar') == 1,
          f'facetas incorrectas: {f}')

@test
def incidencias_de_revisores(w):
    org = w.org('ana'); p = w.project('ana', org); m, v = model(w, 'ana', p)
    w.add_member('ana', p, 'rev', 'reviewer'); w.add_member('ana', p, 'vis', 'viewer'); w.add_member('ana', p, 'rev2', 'reviewer')
    i = w.run('rev', "insert into public.issues (project_id, model_version_id, title, element_source_ids) values (%s, %s, 'Choque ducto', '{u-1}') returning id",
              (p, v), fetch='val')
    check(w.run('rev', "insert into public.issue_comments (issue_id, project_id, body) values (%s, %s, 'Revisar') returning id", (i, p), fetch='val'),
          'el revisor no comenta')
    check(w.denied('vis', "insert into public.issues (project_id, title) values (%s, 'x')", (p,)), 'un viewer creó incidencias')
    check(w.denied('rev2', "update public.issues set status = 'cerrada' where id = %s", (i,)), 'otro revisor cerró una incidencia ajena')
    check(w.run('ana', "update public.issues set status = 'en_proceso', assignee = %s where id = %s", (w.user('rev2'), i), fetch='none') == 1,
          'el owner no asigna')

# ───────────────────────── Fase 5: 4D ─────────────────────────
@test
def calendario_4d_y_versiones(w):
    org = w.org('ana'); p = w.project('ana', org); m, v1 = model(w, 'ana', p)
    w.run('ana', 'select public.upsert_element_mappings(%s, %s)', (v1, json.dumps(
        [{'source_id': f'e{i}', 'dbid': 100 + i} for i in range(4)])))
    tasks = [{'external_id': 'T1', 'name': 'Estructura', 'planned_start': '2026-01-05', 'planned_end': '2026-03-01'},
             {'external_id': 'T1.1', 'parent_external_id': 'T1', 'name': 'Columnas', 'planned_start': '2026-01-05', 'planned_end': '2026-02-01'},
             {'external_id': 'T2', 'name': 'Andamio', 'task_type': 'temporal', 'planned_start': '2026-01-05', 'planned_end': '2026-04-01'},
             {'external_id': 'T3', 'name': 'Acabados', 'task_type': 'pintar', 'planned_start': '2026-03-01', 'planned_end': '2026-05-01'}]
    r = w.run('ana', 'select public.import_schedule(%s, %s, %s)', (p, m, json.dumps(tasks)), fetch='val')
    check(r['importadas'] == 4 and len(r['avisos']) == 1, f'importación: {r}')
    check(w.run('ana', "select (select external_id from public.tasks x where x.id = t.parent_id) from public.tasks t where external_id = 'T1.1'",
                fetch='val') == 'T1', 'jerarquía perdida')
    w.run('ana', 'select public.set_task_links(%s, %s, %s)', (p, m, json.dumps(
        [{'external_id': 'T1.1', 'source_ids': ['e0', 'e1']}, {'external_id': 'T2', 'source_ids': ['e2']},
         {'external_id': 'NOEXISTE', 'source_ids': ['e3']}])))
    sch = w.run('ana', 'select public.schedule_for_version(%s)', (v1,), fetch='val')
    cols = next(t for t in sch['tasks'] if t['external_id'] == 'T1.1')
    check(sorted(cols['dbids']) == [100, 101], f'dbids: {cols["dbids"]}')
    check('Acabados' in sch['report']['tareas_sin_elementos'], f'reporte: {sch["report"]}')
    # Versión 2 sin el elemento e1 → referencias rotas reportadas, no silenciosas
    v2 = w.run('ana', "select public.create_model_version(%s, 'v2', 'torre_v2.nwd', 1000)", (m,), fetch='val')['id']
    w.run('ana', 'select public.upsert_element_mappings(%s, %s)', (v2, json.dumps(
        [{'source_id': s, 'dbid': 900 + i} for i, s in enumerate(['e0', 'e2', 'e3', 'e9'])])))
    w.run('ana', "insert into public.issues (project_id, model_version_id, title, element_source_ids) values (%s, %s, 'Revisar columna', '{e1}')", (p, v1))
    cmp = w.run('ana', 'select public.compare_model_versions(%s, %s)', (v1, v2), fetch='val')
    check(cmp['eliminados'] == 1 and cmp['agregados'] == 1 and cmp['vinculos_4d_rotos'] == 1 and len(cmp['incidencias_afectadas']) == 1,
          f'comparación: {cmp}')
    sch2 = w.run('ana', 'select public.schedule_for_version(%s)', (v2,), fetch='val')
    check(sch2['report']['vinculos_ausentes_en_version'] == 1, 'el vínculo roto no se reportó en la versión 2')
    check(w.denied('beto', 'select public.import_schedule(%s, %s, %s)', (p, m, json.dumps(tasks))), 'B importó en A')

# ───────────────────────── Fase 6: operación ─────────────────────────
@test
def auditoria(w):
    org, p, u = showroom(w)
    lead(w, space=u)
    rows = w.run('ana', 'select entity, action, detail from public.audit_log where project_id = %s', (p,))
    ents = {r[0] for r in rows}
    check({'projects', 'publications', 'publication_versions', 'spaces', 'leads'} <= ents, f'faltan eventos: {ents}')
    check('cliente@correo.mx' not in json.dumps([r[2] for r in rows]), 'datos personales en la auditoría')
    check(w.run('beto', 'select count(*) from public.audit_log', fetch='val') == 0, 'B lee la auditoría de A')

@test
def marca_y_cuota(w):
    org = w.org('ana')
    check(w.run('ana', """update public.organizations set branding = '{"name":"AgelArq","accent":"#B89D74","logo_url":"https://x.mx/l.png"}' where id = %s""",
                (org,), fetch='none') == 1, 'marca válida rechazada')
    check(w.denied('ana', """update public.organizations set branding = '{"accent":"red; background:url(x)"}' where id = %s""", (org,)),
          'color inválido aceptado')
    check(w.denied('ana', """update public.organizations set branding = '{"logo_url":"javascript:x"}' where id = %s""", (org,)),
          'logo javascript: aceptado')
    check(w.denied('ana', 'update public.organizations set quota_bytes = 999999999999 where id = %s', (org,)), 'el cliente se subió la cuota')
    check(w.run('service', 'update public.organizations set quota_bytes = 5368709120 where id = %s', (org,), fetch='none') == 1,
          'el servicio no ajusta cuotas')

@test
def exportacion_y_uso(w):
    org, p, u = showroom(w); lead(w, space=u); w.add_member('ana', p, 'vis', 'viewer')
    e = w.run('ana', 'select public.export_project(%s)', (p,), fetch='val')
    check(e['format'] == 'agelarq-project-export' and len(e['tree']['scenes']) == 2 and len(e['leads']) == 1
          and len(e['publications'][0]['versions']) == 1 and len(e['members']) == 2, 'exportación incompleta')
    ev = w.run('vis', 'select public.export_project(%s)', (p,), fetch='val')
    check(ev['leads'] == [] and ev['members'] == [], 'un viewer exportó datos personales')
    usage = w.run('ana', 'select public.org_usage(%s)', (org,), fetch='val')
    check(usage['proyectos'] == 1 and usage['publicaciones'] == 1 and usage['prospectos_30d'] == 1, f'uso: {usage}')
    check(w.denied('beto', 'select public.org_usage(%s)', (org,)), 'B ve el uso de A')

@test
def funciones_privadas_no_expuestas_a_anon(w):
    org = w.org('ana'); p = w.project('ana', org)
    for fn, args in [('save_project_tree', (p, '{}', 0)), ('load_project_tree', (p,)), ('export_project', (p,)),
                     ('create_publication', (p, 'visor', 'x', '')), ('reserve_upload', (p, 'media', 'pano', 'a', 1, None)),
                     ('my_access', ()), ('org_usage', (org,))]:
        ph = ', '.join(['%s'] * len(args))
        try:
            w.run('anon', f'select public.{fn}({ph})', args)
            raise AssertionError(f'anon ejecutó {fn}')
        except errors.InsufficientPrivilege:
            pass
    try:
        w.run('anon', "select public.publication_stats(%s, 30)", (str(uuid.uuid4()),))
        raise AssertionError('anon leyó estadísticas')
    except errors.InsufficientPrivilege:
        pass

@test
def medicion_anonima(w):
    org = w.org('ana'); p = w.project('ana', org)
    save(w, 'ana', p, tree(p), 0)
    pub, _ = published(w, 'ana', p, kind='showroom', slug='torre-medida')
    for ev in ('page_view', 'page_view', 'tour_open', 'evento_raro'):
        w.run('anon', 'select public.track_event(%s, %s)', ('torre-medida', ev))
    w.run('anon', "select public.track_event('no-existe', 'page_view')")          # sin error, sin registro
    stats = w.run('ana', 'select public.publication_stats(%s, 30)', (pub,), fetch='val')
    check(stats == {'page_view': 2, 'tour_open': 1}, f'conteo inesperado: {stats}')
    check(w.denied('anon', 'select 1 from public.publication_metrics'), 'anon ve métricas')
    w.org('beto')
    check(w.run('beto', 'select public.publication_stats(%s, 30)', (pub,), fetch='val') == {}, 'otra organización vio las métricas')
    cols = w.run('service', "select column_name from information_schema.columns where table_name = 'publication_metrics'")
    check(not {c[0] for c in cols} & {'ip', 'user_agent', 'visitor', 'email'}, 'la medición guarda datos personales')

@test
def acceso_para_funciones_aps(w):
    org = w.org('ana'); p = w.project('ana', org); w.add_member('ana', p, 'vic', 'viewer')
    m, v = model(w, 'ana', p)
    a = w.run('ana', 'select public.model_version_access(%s)', (v,), fetch='val')
    check(a['role'] == 'owner' and a['can_edit'] is True and a['source_name'] == 'torre.nwd', f'acceso owner: {a}')
    b = w.run('vic', 'select public.model_version_access(%s)', (v,), fetch='val')
    check(b['role'] == 'viewer' and b['can_edit'] is False, f'acceso viewer: {b}')
    w.org('beto')
    check(w.run('beto', 'select public.model_version_access(%s)', (v,), fetch='val') is None, 'otra organización vio la versión')
    try:
        w.run('anon', 'select public.model_version_access(%s)', (v,)); raise AssertionError('anon consultó acceso')
    except errors.InsufficientPrivilege: pass
    # el estado solo lo escribe el servidor
    check(w.denied('ana', "update public.model_versions set status = 'ready' where id = %s", (v,)), 'el usuario marcó la conversión como lista')
    check(w.run('service', "update public.model_versions set status = 'ready', aps_urn = 'dXJu' where id = %s", (v,), fetch='none') == 1,
          'el servidor no pudo actualizar el estado')

@test
def revisor_guarda_vistas_lector_no(w):
    org = w.org('ana'); p = w.project('ana', org)
    w.add_member('ana', p, 'rev', 'reviewer'); w.add_member('ana', p, 'lec', 'viewer')
    m, v = model(w, 'ana', p)
    q = "insert into public.viewpoints (project_id, model_id, name, created_by) values (%s, %s, 'Cuarto de bombas', auth.uid()) returning id"
    vp = w.run('rev', q, (p, m), fetch='val')
    check(vp is not None, 'el revisor no pudo guardar la vista')
    check(w.denied('lec', q, (p, m)), 'un lector guardó una vista')
    check(w.denied('rev', "insert into public.viewpoints (project_id, model_id, name, created_by) values (%s, %s, 'x', %s)", (p, m, w.users['ana'])),
          'el revisor guardó una vista a nombre de otro')
    vp2 = w.run('ana', q, (p, m), fetch='val')
    check(w.denied('rev', 'delete from public.viewpoints where id = %s', (vp2,)), 'el revisor borró la vista de otro')
    check(w.run('rev', 'delete from public.viewpoints where id = %s', (vp,), fetch='none') == 1, 'el revisor no pudo borrar su vista')

@test
def avisos_de_prospectos_solo_servidor(w):
    org = w.org('ana'); p = w.project('ana', org)
    save(w, 'ana', p, tree(p), 0)
    published(w, 'ana', p, kind='showroom', slug='torre-avisos')
    w.conn.execute("""update public.projects set showroom = '{"notify_email": "ventas@estudio.mx", "webhook": "https://crm.example/hook"}' where id = %s""", (p,))
    lead = w.run('anon', "select public.submit_lead('torre-avisos', null, 'Laura', 'laura@correo.mx', '', '', true, '{}')", fetch='val')
    for who in ('anon', 'ana'):
        try:
            w.run(who, 'select * from public.pending_lead_notifications(10)'); raise AssertionError(f'{who} leyó avisos pendientes')
        except errors.InsufficientPrivilege: pass
    rows = w.run('service', 'select lead_id, notify_email, webhook from public.pending_lead_notifications(10)')
    check(len(rows) == 1 and str(rows[0][0]) == str(lead) and rows[0][1] == 'ventas@estudio.mx', f'pendientes: {rows}')
    w.run('service', 'select public.mark_lead_notified(%s)', (lead,))
    check(w.run('service', 'select count(*) from public.pending_lead_notifications(10)', fetch='val') == 0, 'sigue pendiente tras avisar')

@test
def catalogo_niveles_importacion_atomica(w):
    org=w.org('ana');p=w.project('ana',org)
    data={'groups':[{'key':'a','name':'Torre A'},{'key':'b','name':'Torre B'}],
          'levels':[{'key':'a/1','groupKey':'a','name':'Nivel 1'},{'key':'b/1','groupKey':'b','name':'Nivel 1'}],
          'units':[{'groupKey':'a','levelKey':'a/1','data':{'name':'101','code':'A101','availability':'disponible'}},
                   {'groupKey':'b','levelKey':'b/1','data':{'name':'101','code':'B101','availability':'vendida'}}], 'problems':[]}
    r=w.run('ana','select public.import_catalog(%s,%s)',(p,json.dumps(data)),fetch='val')
    check(r['created']==2,'no importó dos unidades')
    levels=w.run('ana',"select parent_id from public.spaces where project_id=%s and kind='nivel'",(p,))
    check(len(levels)==2 and levels[0][0]!=levels[1][0],'mezcló niveles de torres diferentes')
    before=w.run('ana','select count(*) from public.spaces where project_id=%s',(p,),fetch='val')
    data['units'][1]['data']['code']='a101'
    check(w.denied('ana','select public.import_catalog(%s,%s)',(p,json.dumps(data))),'permitió claves repetidas')
    check(w.run('ana','select count(*) from public.spaces where project_id=%s',(p,),fetch='val')==before,'dejó importación parcial')

@test
def catalogo_importacion_exige_edicion(w):
    org=w.org('ana');p=w.project('ana',org);w.add_member('ana',p,'lector','viewer');w.org('otro')
    data=json.dumps({'groups':[],'levels':[],'units':[],'problems':[]})
    check(w.denied('lector','select public.import_catalog(%s,%s)',(p,data)),'lector importó catálogo')
    check(w.denied('otro','select public.import_catalog(%s,%s)',(p,data)),'otra organización importó catálogo')
    check(w.denied('anon','select public.import_catalog(%s,%s)',(p,data)),'anónimo importó catálogo')

@test
def workspace_sync_reserva_idempotente(w):
    org=w.org('ana');p=w.project('ana',org);w.add_member('ana',p,'lector','viewer')
    args=(p,'local-a','media','image','foto.png',1000,'image/png')
    r=w.run('ana','select public.begin_sync_asset(%s,%s,%s,%s,%s,%s,%s)',args,fetch='val')
    again=w.run('ana','select public.begin_sync_asset(%s,%s,%s,%s,%s,%s,%s)',args,fetch='val')
    check(r['asset_id']==again['asset_id'],'reserva duplicada')
    check(w.denied('lector','select public.complete_sync_asset(%s)',(r['asset_id'],)),'lector completó')
    check(w.run('ana','select public.complete_sync_asset(%s)',(r['asset_id'],),fetch='val')['status']=='uploading','objeto ausente se marcó completo')
    w.run('ana',"insert into storage.objects(bucket_id,name,owner,metadata) values('media',%s,auth.uid(),%s)",(r['path'],json.dumps({'size':1000,'mimetype':'image/png'})),fetch='none')
    a=w.run('ana','select public.complete_sync_asset(%s)',(r['asset_id'],),fetch='val')
    b=w.run('ana','select public.complete_sync_asset(%s)',(r['asset_id'],),fetch='val')
    check(a['status']==b['status']=='ready','completar no idempotente')
    changed=(*args[:5],1001,args[6])
    check(w.denied('ana','select public.begin_sync_asset(%s,%s,%s,%s,%s,%s,%s)',changed),'local ID cambió archivo')

@test
def workspace_sync_snapshot_atomico(w):
    org=w.org('ana');p=w.project('ana',org);sid=str(uuid.uuid4());space=str(uuid.uuid4())
    tree={'project':{'id':str(p),'name':'Nuevo'},'scenes':[{'id':sid,'name':'Sala','pano_url':'https://example.test/a.jpg','hs':[]}]}
    data={'tree':tree,'spaces':[{'id':space,'name':'Departamento','kind':'unidad','scene_ids':[sid]}],'showroom':{'description':'Borrador'},'privateSettings':{}}
    r=w.run('ana','select public.save_workspace_snapshot(%s,%s,%s)',(p,json.dumps(data),0),fetch='val')
    check(r['revision']==1,'revisión no incrementada')
    check(w.run('ana','select name from public.spaces where id=%s',(space,),fetch='val')=='Departamento','catálogo no guardado')
    data['tree']['project']['name']='Perdido'
    check(w.denied('ana','select public.save_workspace_snapshot(%s,%s,%s)',(p,json.dumps(data),0)),'pisó revisión')
    check(w.run('ana','select name from public.projects where id=%s',(p,),fetch='val')=='Nuevo','conflicto alteró proyecto')

@test
def workspace_sync_mime_revocado_y_ciclo(w):
    org=w.org('ana');p=w.project('ana',org);w.add_member('ana',p,'ed','editor')
    r=w.run('ed','select public.begin_sync_asset(%s,%s,%s,%s,%s,%s,%s)',(p,'x','media','image','a.png',10,'image/png'),fetch='val')
    w.run('ed',"insert into storage.objects(bucket_id,name,owner,metadata) values('media',%s,auth.uid(),%s)",(r['path'],json.dumps({'size':10,'mimetype':'text/html'})),fetch='none')
    check(w.denied('ed','select public.complete_sync_asset(%s)',(r['asset_id'],)),'MIME real incorrecto aceptado')
    w.run('ana',"delete from public.project_members where project_id=%s and user_id=%s",(p,w.user('ed')),fetch='none')
    check(w.denied('ed','select public.complete_sync_asset(%s)',(r['asset_id'],)),'rol revocado completó')
    a,b=str(uuid.uuid4()),str(uuid.uuid4())
    data={'tree':{'project':{'id':str(p),'name':'Ciclo'},'scenes':[]},'spaces':[{'id':a,'parent_id':b,'kind':'nivel','name':'A'},{'id':b,'parent_id':a,'kind':'nivel','name':'B'}],'showroom':{}}
    check(w.denied('ana','select public.save_workspace_snapshot(%s,%s,0)',(p,json.dumps(data))),'ciclo guardado')
    check(w.run('ana','select revision from public.projects where id=%s',(p,),fetch='val')==0,'ciclo no hizo rollback')

@test
def showroom_experience_snapshot_privado(w):
    org=w.org('ana');p=w.project('ana',org)
    sr={'description':'Comercial','bimVersionId':'SECRETO','privateSettings':{'token':'NO'},'opening':{'title':'Hola','secret':'NO'},'views':[{'id':'f','image':'https://example.test/f.jpg','role':'facade','secret':'NO'}],'experience':{'version':1,'facadeViewId':'f'}}
    w.run('ana','update public.projects set showroom=%s where id=%s',(json.dumps(sr),p),fetch='none')
    snap=w.conn.execute('select app.build_snapshot(%s,%s)',(p,'showroom')).fetchone()[0]
    check('SECRETO' not in json.dumps(snap) and 'NO' not in json.dumps(snap),'filtró contenido privado')
    sr['experience']['entryTargetViewId']='f'
    w.run('ana','update public.projects set showroom=%s where id=%s',(json.dumps(sr),p),fetch='none')
    try:w.conn.execute('select app.build_snapshot(%s,%s)',(p,'showroom'));raise AssertionError('entrada a sí misma aceptada')
    except errors.RaiseException:pass

@test
def showroom_experience_geometria_y_destinos(w):
    org=w.org('ana');p=w.project('ana',org)
    valid={'views':[{'id':'f','image':'https://example.test/f.jpg','regions':[{'points':[[0,0],[100,0],[100,100],[0,100]],'radius':0.5}]}],'experience':{'version':1,'facadeViewId':'f'},'model3d':None}
    w.conn.execute('select app.validate_showroom_experience(%s,%s)',(p,json.dumps(valid)))
    import copy
    cases=[]
    x=copy.deepcopy(valid);x['views'][0]['regions'][0]['radius']=3;cases.append(x)
    x=copy.deepcopy(valid);x['views'][0]['regions'][0]['points']=[[0,0],[100,100],[0,100],[100,0]];cases.append(x)
    x=copy.deepcopy(valid);x['views'][0]['spaceId']=str(uuid.uuid4());cases.append(x)
    x=copy.deepcopy(valid);x['views'][0]['image']='javascript:alert(1)';cases.append(x)
    x=copy.deepcopy(valid);x['views']*=257;cases.append(x)
    for x in cases:
        try:w.conn.execute('select app.validate_showroom_experience(%s,%s)',(p,json.dumps(x)));raise AssertionError('entrada inválida aceptada')
        except errors.RaiseException:pass

# ───────────────────────── ejecución ─────────────────────────
def main():
    only = sys.argv[sys.argv.index('-k') + 1] if '-k' in sys.argv else None
    results = []
    for fn in TESTS:
        if only and only not in fn.__name__: continue
        conn = fresh_db()
        w = World(conn)
        t0 = time.time()
        try:
            fn(w); status, info = 'PASS', ''
        except AssertionError as e:
            status, info = 'FAIL', str(e)
        except Exception as e:
            status, info = 'ERROR', f'{type(e).__name__}: {str(e).splitlines()[0][:220]}'
        conn.close()
        results.append(status)
        print(f'{status:5}  {fn.__name__:52} {time.time()-t0:4.1f}s  {info[:200]}', flush=True)
    ok = results.count('PASS')
    print(f'\n{ok}/{len(results)} pruebas de permisos superadas')
    sys.exit(0 if ok == len(results) else 1)

if __name__ == '__main__':
    main()
