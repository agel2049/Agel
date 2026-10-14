#!/usr/bin/env python3
"""
mini-Supabase para pruebas: un servidor HTTP local con la misma forma que
la API de Supabase, para que la app hable con él igual que con tu proyecto.

  /rest/v1/*        → PostgREST REAL sobre Postgres con todas las migraciones
                      (las políticas RLS se evalúan de verdad).
  /auth/v1/*        → emulación de Auth: contraseña, enlace mágico, refresco,
                      usuario, salir. Emite JWT firmados con el mismo secreto
                      que valida PostgREST.
  /storage/v1/*     → emulación de Storage: cada subida, borrado y listado se
                      autoriza insertando/consultando storage.objects COMO el
                      usuario, así que deciden las políticas de la migración.
                      Igual que Supabase, los .html públicos se sirven como
                      text/plain.
  /functions/v1/*   → reenvía a funciones de servidor que se registren.

Uso desde Python:
    sb = MiniSupa.start()          # crea BD, aplica migraciones, levanta todo
    sb.url, sb.anon_key, sb.service_key
    sb.create_user('ana@x.mx', 'clave')  ; sb.magic_links[email]
    sb.stop()
"""
import base64, hashlib, hmac, http.server, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, time, urllib.request, uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
import psycopg

ROOT = Path(__file__).resolve().parent.parent
PG_SERVER = os.environ.get('AGEL_PG', 'host=/tmp port=54329 user=postgres')
PGRST_BIN = os.environ.get('AGEL_POSTGREST', shutil.which('postgrest') or '/home/claude/infra/postgrest')
JWT_SECRET = 'agel-pruebas-secreto-de-al-menos-32-caracteres!!'
PUBLIC_BUCKETS = {'panoramas', 'media', 'models'}


def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def b64url_dec(s): return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))

def jwt_sign(payload, secret=JWT_SECRET):
    h = b64url(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    p = b64url(json.dumps(payload).encode())
    sig = hmac.new(secret.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest()
    return f'{h}.{p}.{b64url(sig)}'

def jwt_verify(token, secret=JWT_SECRET):
    try:
        h, p, s = token.split('.')
        exp = hmac.new(secret.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(exp, b64url_dec(s)): return None
        claims = json.loads(b64url_dec(p))
        if claims.get('exp') and claims['exp'] < time.time(): return None
        return claims
    except Exception:
        return None

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]


class MiniSupa:
    def __init__(self, db):
        self.db = db
        self.users = {}            # email -> {id, password}
        self.refresh = {}          # refresh_token -> user_id
        self.magic_links = {}      # email -> url
        self.objects = {}          # (bucket, path) -> (bytes, content_type)
        self.functions = {}        # name -> base url
        self.requests = []
        self.anon_key = jwt_sign({'role': 'anon', 'iss': 'minisupa', 'exp': int(time.time()) + 86400 * 365})
        self.service_key = jwt_sign({'role': 'service_role', 'iss': 'minisupa', 'exp': int(time.time()) + 86400 * 365})
        self.token_ttl = 3600

    # ── arranque ──────────────────────────────────────────────────────────
    @classmethod
    def start(cls, db='agel_e2e'):
        with psycopg.connect(PG_SERVER + ' dbname=postgres', autocommit=True) as c:
            c.execute(f'drop database if exists {db} with (force)')
            c.execute(f'create database {db}')
        conn = psycopg.connect(PG_SERVER + f' dbname={db}', autocommit=True)
        conn.execute((ROOT / 'supabase/tests/emulation.sql').read_text())
        for m in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            conn.execute(m.read_text())
        conn.close()
        sb = cls(db)
        sb._start_postgrest()
        sb._start_http()
        return sb

    def _start_postgrest(self):
        self.pgrst_port = free_port()
        host = re.search(r'host=(\S+)', PG_SERVER).group(1); port = re.search(r'port=(\d+)', PG_SERVER).group(1)
        self._cfg = tempfile.NamedTemporaryFile('w', suffix='.conf', delete=False)
        self._cfg.write(f'''db-uri = "postgres://authenticator:authenticator@/{self.db}?host={host}&port={port}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "{JWT_SECRET}"
server-port = {self.pgrst_port}
server-host = "127.0.0.1"
db-pool = 8
log-level = "crit"
''')
        self._cfg.close()
        self.pgrst = subprocess.Popen([PGRST_BIN, self._cfg.name], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(150):           # esperar a que cargue la caché de esquema (503 mientras tanto)
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{self.pgrst_port}/', timeout=1); break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError('PostgREST no arrancó: ' + self.pgrst.stderr.read().decode()[:500])

    def _start_http(self):
        sb = self
        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *a): pass
            def do_OPTIONS(self): sb._cors_only(self)
            def do_GET(self): sb._dispatch(self, 'GET')
            def do_POST(self): sb._dispatch(self, 'POST')
            def do_PUT(self): sb._dispatch(self, 'PUT')
            def do_PATCH(self): sb._dispatch(self, 'PATCH')
            def do_DELETE(self): sb._dispatch(self, 'DELETE')
            def do_HEAD(self): sb._dispatch(self, 'HEAD')
        self.port = free_port()
        self.httpd = http.server.ThreadingHTTPServer(('127.0.0.1', self.port), H)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.port}'

    def stop(self):
        self.httpd.shutdown()
        self.pgrst.terminate()
        try: self.pgrst.wait(5)
        except Exception: self.pgrst.kill()
        os.unlink(self._cfg.name)

    # ── utilidades para las pruebas ───────────────────────────────────────
    def sql(self, q, params=None):
        with psycopg.connect(PG_SERVER + f' dbname={self.db}', autocommit=True) as c:
            cur = c.execute(q, params)
            return cur.fetchall() if cur.description else None

    def create_user(self, email, password='clave-segura-123'):
        uid = str(uuid.uuid4())
        self.sql('insert into auth.users (id, email) values (%s, %s)', (uid, email))
        self.users[email.lower()] = {'id': uid, 'password': password, 'email': email.lower()}
        return uid

    def token_for(self, email):
        u = self.users[email.lower()]
        return self._issue(u)['access_token']

    def _issue(self, u):
        now = int(time.time())
        access = jwt_sign({'sub': u['id'], 'role': 'authenticated', 'aud': 'authenticated', 'email': u['email'],
                           'iat': now, 'exp': now + self.token_ttl})
        refresh = uuid.uuid4().hex
        self.refresh[refresh] = u['id']
        return {'access_token': access, 'token_type': 'bearer', 'expires_in': self.token_ttl,
                'expires_at': now + self.token_ttl, 'refresh_token': refresh,
                'user': {'id': u['id'], 'email': u['email'], 'aud': 'authenticated', 'role': 'authenticated'}}

    # ── HTTP ──────────────────────────────────────────────────────────────
    CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Type, ETag'}

    def _cors_only(self, h):
        h.send_response(204)
        for k, v in self.CORS.items(): h.send_header(k, v)
        h.send_header('Content-Length', '0'); h.end_headers()

    def _reply(self, h, status, body=b'', ctype='application/json', extra=None):
        if isinstance(body, (dict, list)): body = json.dumps(body).encode()
        elif isinstance(body, str): body = body.encode()
        h.send_response(status)
        for k, v in self.CORS.items(): h.send_header(k, v)
        h.send_header('Content-Type', ctype)
        h.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items(): h.send_header(k, v)
        h.end_headers()
        if h.command != 'HEAD': h.wfile.write(body)

    def _body(self, h):
        n = int(h.headers.get('Content-Length') or 0)
        return h.rfile.read(n) if n else b''

    def _claims(self, h):
        auth = h.headers.get('Authorization', '')
        tok = auth[7:] if auth.lower().startswith('bearer ') else (h.headers.get('apikey') or '')
        return jwt_verify(tok) if tok else None

    def _dispatch(self, h, method):
        path = urlparse(h.path).path
        try:
            if path.startswith('/rest/v1/'):        return self._rest(h, method)
            if path.startswith('/auth/v1/'):        return self._auth(h, method, path[len('/auth/v1/'):])
            if path.startswith('/storage/v1/'):     return self._storage(h, method, path[len('/storage/v1/'):])
            if path.startswith('/functions/v1/'):   return self._functions(h, method, path[len('/functions/v1/'):])
            return self._reply(h, 404, {'message': 'not found'})
        finally:
            self.requests.append((method, path))

    # REST → PostgREST real
    def _rest(self, h, method):
        body = self._body(h) if method in ('POST', 'PUT', 'PATCH', 'DELETE') else None
        url = f'http://127.0.0.1:{self.pgrst_port}' + h.path[len('/rest/v1'):]
        req = urllib.request.Request(url, data=body, method=method)
        for k in ('Authorization', 'Content-Type', 'Prefer', 'Accept', 'Range', 'Content-Profile', 'Accept-Profile'):
            if h.headers.get(k): req.add_header(k, h.headers[k])
        if not h.headers.get('Authorization') and h.headers.get('apikey'):
            req.add_header('Authorization', 'Bearer ' + h.headers['apikey'])
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data, status, ctype, cr = r.read(), r.status, r.headers.get('Content-Type', 'application/json'), r.headers.get('Content-Range')
        except urllib.error.HTTPError as e:
            data, status, ctype, cr = e.read(), e.code, e.headers.get('Content-Type', 'application/json'), None
        self._reply(h, status, data, ctype, {'Content-Range': cr} if cr else None)

    # Auth emulado
    def _auth(self, h, method, sub):
        q = parse_qs(urlparse(h.path).query)
        body = json.loads(self._body(h) or b'{}') if method in ('POST', 'PUT') else {}
        if sub == 'token' and q.get('grant_type') == ['password']:
            u = self.users.get(str(body.get('email', '')).lower())
            if not u or u['password'] != body.get('password'):
                return self._reply(h, 400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials',
                                            'code': 'invalid_credentials', 'msg': 'Invalid login credentials'})
            return self._reply(h, 200, self._issue(u))
        if sub == 'token' and q.get('grant_type') == ['refresh_token']:
            uid = self.refresh.pop(body.get('refresh_token'), None)
            u = next((x for x in self.users.values() if x['id'] == uid), None)
            if not u: return self._reply(h, 400, {'error': 'invalid_grant', 'msg': 'Invalid Refresh Token'})
            return self._reply(h, 200, self._issue(u))
        if sub == 'otp' and method == 'POST':
            email = str(body.get('email', '')).lower(); u = self.users.get(email)
            redirect = (q.get('redirect_to') or [''])[0]
            if u:
                s = self._issue(u)
                frag = '&'.join(f'{k}={s[k]}' for k in ('access_token', 'expires_in', 'expires_at', 'refresh_token', 'token_type'))
                self.magic_links[email] = f'{redirect}#{frag}&type=magiclink'
            return self._reply(h, 200, {})
        if sub == 'recover' and method == 'POST':
            email = str(body.get('email', '')).lower(); u = self.users.get(email)
            redirect = (q.get('redirect_to') or [''])[0]
            if u:
                s = self._issue(u)
                frag = '&'.join(f'{k}={s[k]}' for k in ('access_token', 'expires_in', 'expires_at', 'refresh_token', 'token_type'))
                self.magic_links[email] = f'{redirect}#{frag}&type=recovery'
            return self._reply(h, 200, {})
        if sub == 'user':
            c = self._claims(h)
            if not c or c.get('role') != 'authenticated': return self._reply(h, 401, {'msg': 'Invalid JWT'})
            u = next(x for x in self.users.values() if x['id'] == c['sub'])
            if method == 'PUT' and body.get('password'): u['password'] = body['password']
            return self._reply(h, 200, {'id': u['id'], 'email': u['email'], 'aud': 'authenticated', 'role': 'authenticated'})
        if sub == 'logout':
            return self._reply(h, 204, b'')
        return self._reply(h, 404, {'msg': 'no emulado: ' + sub})

    # Storage emulado, autorizado por las políticas de Postgres
    def _as(self, claims, sql, params):
        with psycopg.connect(PG_SERVER + f' dbname={self.db}') as c:
            with c.transaction():
                role = (claims or {}).get('role', 'anon')
                role = role if role in ('anon', 'authenticated', 'service_role') else 'anon'
                c.execute(f'set local role {role}')
                c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims or {'role': 'anon'}),))
                cur = c.execute(sql, params)
                return cur.fetchall() if cur.description else cur.rowcount

    def _storage_error(self, h, status, msg):
        self._reply(h, 400 if status in (403, 404) else status,
                    {'statusCode': str(status), 'error': 'Unauthorized' if status == 403 else 'Error', 'message': msg})

    def _storage(self, h, method, sub):
        sub = unquote(sub)
        q = parse_qs(urlparse(h.path).query)
        m = re.match(r'(?:object/public|render/image/public)/([^/]+)/(.+)$', sub)
        if m and method in ('GET', 'HEAD'):
            bucket, path = m.groups()
            obj = self.objects.get((bucket, path))
            if bucket not in PUBLIC_BUCKETS or not obj:
                return self._storage_error(h, 404, 'Object not found')
            ctype = obj[1]
            if 'html' in ctype: ctype = 'text/plain'     # como Supabase: el HTML no se ejecuta
            return self._reply(h, 200, obj[0], ctype)
        m = re.match(r'object/sign/([^/]+)/(.+)$', sub)
        if m and method == 'POST':
            bucket, path = m.groups(); claims = self._claims(h)
            ok = self._as(claims, 'select count(*) from storage.objects where bucket_id = %s and name = %s', (bucket, path))[0][0]
            if not ok: return self._storage_error(h, 404, 'Object not found')
            tok = jwt_sign({'url': f'{bucket}/{path}', 'exp': int(time.time()) + 600})
            return self._reply(h, 200, {'signedURL': f'/object/sign/{bucket}/{path}?token={tok}'})
        if m and method == 'GET':
            bucket, path = m.groups(); c = jwt_verify((q.get('token') or [''])[0])
            obj = self.objects.get((bucket, path))
            if not c or c.get('url') != f'{bucket}/{path}' or not obj: return self._storage_error(h, 400, 'Invalid signature')
            return self._reply(h, 200, obj[0], obj[1])
        m = re.match(r'object/authenticated/([^/]+)/(.+)$', sub)
        if m and method == 'GET':
            bucket, path = m.groups(); claims = self._claims(h)
            ok = self._as(claims, 'select count(*) from storage.objects where bucket_id = %s and name = %s', (bucket, path))[0][0]
            obj = self.objects.get((bucket, path))
            if not ok or not obj: return self._storage_error(h, 404, 'Object not found')
            return self._reply(h, 200, obj[0], obj[1])
        m = re.match(r'object/list/([^/]+)$', sub)
        if m and method == 'POST':
            bucket = m.group(1); body = json.loads(self._body(h) or b'{}'); prefix = body.get('prefix', '')
            rows = self._as(self._claims(h), 'select name from storage.objects where bucket_id = %s and name like %s',
                            (bucket, prefix + '%'))
            return self._reply(h, 200, [{'name': r[0][len(prefix):].lstrip('/') if prefix else r[0],
                                         'metadata': {'size': len(self.objects.get((bucket, r[0]), (b'',))[0])}} for r in rows])
        m = re.match(r'object/([^/]+)/(.+)$', sub)
        if m and method in ('POST', 'PUT'):
            bucket, path = m.groups(); data = self._body(h); claims = self._claims(h)
            upsert = (h.headers.get('x-upsert') == 'true') or method == 'PUT'
            ctype = h.headers.get('Content-Type', 'application/octet-stream')
            try:
                if (bucket, path) in self.objects:
                    if not upsert: return self._storage_error(h, 409, 'The resource already exists')
                    n = self._as(claims, "update storage.objects set updated_at = now() where bucket_id = %s and name = %s",
                                 (bucket, path))
                    if not n: raise psycopg.errors.InsufficientPrivilege('new row violates row-level security policy')
                else:
                    self._as(claims, 'insert into storage.objects (bucket_id, name, owner, metadata) values (%s, %s, %s, %s)',
                             (bucket, path, (claims or {}).get('sub'), json.dumps({'size': len(data), 'mimetype': ctype})))
            except psycopg.Error as e:
                return self._storage_error(h, 403, str(e).splitlines()[0])
            self.objects[(bucket, path)] = (data, ctype)
            return self._reply(h, 200, {'Key': f'{bucket}/{path}', 'Id': str(uuid.uuid4())})
        if m and method == 'DELETE':
            bucket, path = m.groups()
            n = self._as(self._claims(h), 'delete from storage.objects where bucket_id = %s and name = %s', (bucket, path))
            if not n: return self._storage_error(h, 404, 'Object not found')
            self.objects.pop((bucket, path), None)
            return self._reply(h, 200, {'message': 'Successfully deleted'})
        return self._storage_error(h, 404, 'no emulado: ' + sub)

    # Funciones de servidor registradas
    def _functions(self, h, method, name):
        base = self.functions.get(name.split('/')[0])
        if not base: return self._reply(h, 404, {'message': f'Función {name} no desplegada'})
        body = self._body(h) if method in ('POST', 'PUT', 'PATCH') else None
        req = urllib.request.Request(base + h.path[len('/functions/v1/' + name.split('/')[0]):] if False else base, data=body, method=method)
        for k in ('Authorization', 'Content-Type', 'apikey'):
            if h.headers.get(k): req.add_header(k, h.headers[k])
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return self._reply(h, r.status, r.read(), r.headers.get('Content-Type', 'application/json'))
        except urllib.error.HTTPError as e:
            return self._reply(h, e.code, e.read(), e.headers.get('Content-Type', 'application/json'))


if __name__ == '__main__':
    sb = MiniSupa.start()
    print('mini-Supabase en', sb.url, '\nanon:', sb.anon_key)
    try:
        while True: time.sleep(3600)
    except KeyboardInterrupt:
        sb.stop()
