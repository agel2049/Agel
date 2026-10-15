/* ═══════════════════════════════════════════════════════════════════════
   AgelArq · cliente de datos (Supabase) — compartido por todas las apps

   Sin dependencias: habla directamente con la API REST de Supabase
   (Auth, PostgREST, Storage y Functions). Así no hay que cargar una
   librería externa ni compilar nada.

     const cloud = AgelCloud.client();             // usa window.AGEL_CONFIG
     await cloud.signInWithPassword(email, clave);
     await cloud.rpc('my_access');
     await cloud.upload(projectId, file, { bucket: 'media', kind: 'pano' });

   La sesión se guarda en este navegador (localStorage) y se renueva sola
   antes de vencer. Todo error llega como CloudError con un mensaje en
   español listo para mostrar.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  class CloudError extends Error {
    constructor(message, info = {}) {
      super(message);
      this.name = 'CloudError';
      this.status = info.status || 0;
      this.code = info.code || '';
      this.details = info.details || null;
    }
    get isConflict() { return this.code === 'PT409' || this.status === 409 && /Conflicto/.test(this.message); }
    get isAuth() { return this.status === 401 || this.code === '28000' || this.code === 'PGRST301'; }
    get isForbidden() { return this.code === '42501' || this.status === 403; }
    get isQuota() { return this.code === '53400'; }
  }

  // Traducción de mensajes técnicos frecuentes.
  function friendly(msg, status, code) {
    const m = String(msg || '');
    if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos';
    if (/Email not confirmed/i.test(m)) return 'Confirma tu correo antes de entrar';
    if (/JWT expired|invalid JWT|Invalid Refresh Token/i.test(m)) return 'Tu sesión venció; vuelve a entrar';
    if (/row-level security/i.test(m)) return 'No tienes permiso para esta acción';
    if (/permission denied/i.test(m)) return 'No tienes permiso para esta acción';
    if (code === 'PGRST202' || /Could not find the function/i.test(m)) return 'La base de datos aún no tiene esta función: aplica las migraciones de supabase/migrations';
    if (code === 'PGRST205' || /Could not find the table/i.test(m)) return 'La base de datos aún no tiene esta tabla: aplica las migraciones de supabase/migrations';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión con el servidor';
    if (/Payload too large|exceeded the maximum allowed size/i.test(m) || status === 413) return 'El archivo supera el tamaño permitido por tu plan de Supabase';
    if (/mime type .* is not supported/i.test(m)) return 'Tipo de archivo no permitido en este espacio';
    return m || `Error ${status || ''}`.trim();
  }

  const b64urlDecode = s => {
    try { return JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))); }
    catch (_) { return null; }
  };

  class Cloud {
    constructor(cfg) {
      this.url = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
      this.anonKey = cfg.supabaseAnonKey;
      this.storageKey = cfg.storageKey || 'agel.session';
      this._listeners = new Set();
      this._refreshing = null;
      this._session = this._load();
      this._schedule();
    }

    // ── sesión ────────────────────────────────────────────────────────────
    _load() {
      try { const s = JSON.parse(localStorage.getItem(this.storageKey) || 'null'); return s && s.access_token ? s : null; }
      catch (_) { return null; }
    }
    _save(s) {
      if (s && !s.expires_at && s.expires_in) s.expires_at = Math.floor(Date.now() / 1000) + Number(s.expires_in);
      if (s && !s.user) { const c = b64urlDecode(String(s.access_token).split('.')[1] || ''); if (c) s.user = { id: c.sub, email: c.email }; }
      this._session = s;
      try { s ? localStorage.setItem(this.storageKey, JSON.stringify(s)) : localStorage.removeItem(this.storageKey); } catch (_) {}
      this._schedule();
      this._listeners.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } });
    }
    _schedule() {
      clearTimeout(this._timer);
      if (!this._session || !this._session.refresh_token) return;
      const ms = Math.max(5000, (this._session.expires_at * 1000) - Date.now() - 60000);
      this._timer = setTimeout(() => this.refresh().catch(() => {}), Math.min(ms, 2147483000));
    }
    get session() { return this._session; }
    get user() { return this._session ? this._session.user : null; }
    onAuth(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

    async refresh() {
      if (this._refreshing) return this._refreshing;
      const rt = this._session && this._session.refresh_token;
      if (!rt) throw new CloudError('Sin sesión', { status: 401 });
      this._refreshing = this._auth('token?grant_type=refresh_token', { refresh_token: rt })
        .then(s => { this._save(s); return s; })
        .catch(e => { if (e.status === 400 || e.status === 401) this._save(null); throw e; })
        .finally(() => { this._refreshing = null; });
      return this._refreshing;
    }
    async accessToken() {
      const s = this._session;
      if (!s) return null;
      if (s.expires_at && s.expires_at * 1000 - Date.now() < 30000) await this.refresh();
      return this._session ? this._session.access_token : null;
    }

    async _auth(path, body, method = 'POST', token = null) {
      const res = await fetch(`${this.url}/auth/v1/${path}`, {
        method, headers: Object.assign({ apikey: this.anonKey, 'Content-Type': 'application/json' },
                                       token ? { Authorization: `Bearer ${token}` } : {}),
        body: body ? JSON.stringify(body) : undefined
      }).catch(e => { throw new CloudError(friendly(e.message), { status: 0 }); });
      const text = await res.text();
      let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) {}
      if (!res.ok) {
        const msg = data && (data.msg || data.error_description || data.message || data.error);
        throw new CloudError(friendly(msg, res.status), { status: res.status, code: data && (data.code || data.error) });
      }
      return data;
    }

    async signInWithPassword(email, password) {
      const s = await this._auth('token?grant_type=password', { email: String(email).trim(), password });
      this._save(s); return s.user;
    }
    async sendMagicLink(email, redirectTo) {
      await this._auth(`otp?redirect_to=${encodeURIComponent(redirectTo || location.href.split('#')[0])}`,
                       { email: String(email).trim(), create_user: false });
    }
    async requestPasswordReset(email, redirectTo) {
      await this._auth(`recover?redirect_to=${encodeURIComponent(redirectTo || location.href.split('#')[0])}`,
                       { email: String(email).trim() });
    }
    async updatePassword(password) {
      return this._auth('user', { password }, 'PUT', await this.accessToken());
    }
    /** Lee la sesión que dejan en la URL el enlace mágico o la recuperación. */
    consumeRedirect() {
      const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
      if (h.get('error_description')) {
        history.replaceState(null, '', location.pathname + location.search);
        throw new CloudError(h.get('error_description').replace(/\+/g, ' '), { status: 401 });
      }
      if (!h.get('access_token')) return null;
      const type = h.get('type') || 'magiclink';
      this._save({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'),
                   expires_in: Number(h.get('expires_in') || 3600), expires_at: Number(h.get('expires_at')) || undefined,
                   token_type: 'bearer' });
      history.replaceState(null, '', location.pathname + location.search);
      return type;
    }
    async signOut() {
      const t = this._session && this._session.access_token;
      this._save(null);
      if (t) { try { await this._auth('logout', null, 'POST', t); } catch (_) {} }
    }

    // ── base de datos (PostgREST) ─────────────────────────────────────────
    async _rest(path, { method = 'GET', body, headers = {}, anon = false, retry = true } = {}) {
      const token = anon ? null : await this.accessToken();
      const res = await fetch(`${this.url}/rest/v1/${path}`, {
        method,
        headers: Object.assign({ apikey: this.anonKey, Authorization: `Bearer ${token || this.anonKey}`,
                                 'Content-Type': 'application/json', Accept: 'application/json' }, headers),
        body: body === undefined ? undefined : JSON.stringify(body)
      }).catch(e => { throw new CloudError(friendly(e.message), { status: 0 }); });
      if (res.status === 401 && retry && token && this._session && this._session.refresh_token) {
        await this.refresh(); return this._rest(path, { method, body, headers, anon, retry: false });
      }
      const text = await res.text();
      let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
      if (!res.ok) {
        const d = data && typeof data === 'object' ? data : {};
        throw new CloudError(friendly(d.message || d.msg || text, res.status, d.code), { status: res.status, code: d.code, details: d.details || d.hint });
      }
      return data;
    }
    rpc(fn, args = {}, opts = {}) { return this._rest(`rpc/${fn}`, { method: 'POST', body: args, anon: !!opts.anon }); }
    select(table, query = 'select=*') { return this._rest(`${table}?${query}`); }
    insert(table, rows, { returning = true } = {}) {
      return this._rest(table, { method: 'POST', body: rows, headers: { Prefer: returning ? 'return=representation' : 'return=minimal' } });
    }
    update(table, filter, patch) {
      return this._rest(`${table}?${filter}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } });
    }
    remove(table, filter) { return this._rest(`${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }); }

    // ── archivos (Storage) ────────────────────────────────────────────────
    publicUrl(bucket, path) {
      return `${this.url}/storage/v1/object/public/${bucket}/${String(path).split('/').map(encodeURIComponent).join('/')}`;
    }
    /**
     * Sube un archivo a un proyecto: reserva (cuota + permiso), envía y confirma.
     * @returns {Promise<{asset_id, bucket, path, url}>}
     */
    async upload(projectId, file, { bucket = 'media', kind = 'image', filename, onProgress, width, height, contentType } = {}) {
      const name = filename || file.name || 'archivo';
      const type = contentType || file.type || 'application/octet-stream';
      const r = await this.rpc('reserve_upload', { p_project: projectId, p_bucket: bucket, p_kind: kind,
                                                   p_filename: name, p_bytes: file.size, p_mime: type });
      await this.transferReserved(r,file,{onProgress,contentType:type});
      await this.rpc('complete_upload', { p_asset: r.asset_id, p_width: width || null, p_height: height || null });
      return Object.assign({}, r, { url: this.publicUrl(bucket, r.path) });
    }
    async transferReserved(r,file,{signal,onProgress,contentType}={}) {
      const type=contentType||file.type||'application/octet-stream';
      const token = await this.accessToken();
      if(signal?.aborted)throw new CloudError('Subida pausada');
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${this.url}/storage/v1/object/${r.bucket}/${r.path.split('/').map(encodeURIComponent).join('/')}`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('apikey', this.anonKey);
        xhr.setRequestHeader('Content-Type', type);
        xhr.setRequestHeader('x-upsert', 'false');
        // Rutas únicas: el navegador puede reutilizar el archivo durante una semana.
        xhr.setRequestHeader('Cache-Control', 'max-age=604800');
        if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          let d = {}; try { d = JSON.parse(xhr.responseText); } catch (_) {}
          reject(new CloudError(friendly(d.message || d.error || xhr.responseText, Number(d.statusCode) || xhr.status), { status: xhr.status }));
        };
        xhr.onerror = () => reject(new CloudError('Sin conexión con el servidor al subir', { status: 0 }));
        const abort=()=>xhr.abort();signal?.addEventListener('abort',abort,{once:true});
        xhr.onabort=()=>reject(new CloudError('Subida pausada'));
        xhr.onloadend=()=>signal?.removeEventListener('abort',abort);
        xhr.send(file);
      });
    }
    /** URL temporal para archivos privados (bucket technical). */
    async signedUrl(bucket, path, expiresIn = 600) {
      const token = await this.accessToken();
      const res = await fetch(`${this.url}/storage/v1/object/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST', headers: { apikey: this.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new CloudError(friendly(d.message, res.status), { status: res.status });
      return `${this.url}/storage/v1${d.signedURL || d.signedUrl}`;
    }

    // ── funciones de servidor ─────────────────────────────────────────────
    async invoke(name, body = {}, { anon = false } = {}) {
      const token = anon ? null : await this.accessToken();
      const res = await fetch(`${this.url}/functions/v1/${name}`, {
        method: 'POST',
        headers: { apikey: this.anonKey, Authorization: `Bearer ${token || this.anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(e => { throw new CloudError(friendly(e.message), { status: 0 }); });
      const text = await res.text();
      let d = null; try { d = text ? JSON.parse(text) : null; } catch (_) { d = text; }
      if (!res.ok) {
        if (res.status === 404) throw new CloudError(`La función ${name} no está desplegada en Supabase`, { status: 404 });
        throw new CloudError(friendly(d && (d.error || d.message) || text, res.status), { status: res.status, code: d && d.code });
      }
      return d;
    }
  }

  let _default = null;
  const AgelCloud = {
    Cloud, CloudError,
    client(cfg) {
      if (cfg) return new Cloud(cfg);
      if (!_default) {
        const c = root.AGEL_CONFIG || {};
        if (!c.supabaseUrl || !c.supabaseAnonKey) throw new Error('Falta config.js (supabaseUrl / supabaseAnonKey)');
        _default = new Cloud(c);
      }
      return _default;
    },
    uuid() {
      if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
      const b = new Uint8Array(16); root.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    slugify(s) {
      return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'proyecto';
    }
  };
  root.AgelCloud = AgelCloud;
})(typeof window !== 'undefined' ? window : globalThis);
