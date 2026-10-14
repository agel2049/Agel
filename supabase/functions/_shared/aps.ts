// AgelArq · cliente mínimo de Autodesk Platform Services (APS).
// Autenticación v2 (client credentials), OSS con URLs firmadas de S3 y
// Model Derivative (SVF2). Las credenciales viven solo en los secretos de
// Supabase (APS_CLIENT_ID, APS_CLIENT_SECRET); nunca se envían al navegador.
import { Env, Fetch, HttpError } from './http.ts';

const BASE = 'https://developer.api.autodesk.com';
// APS_BASE_URL solo para pruebas locales (Autodesk simulado). En producción no se define.

export class ApsError extends Error {
  constructor(public status: number, message: string, public detail = '') { super(message); }
}

/** URN para Model Derivative: base64 url-safe sin relleno del objectId. */
export function urnOf(objectId: string): string {
  const bytes = new TextEncoder().encode(objectId);
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Llave del bucket: APS_BUCKET o una derivada del Client ID (única por cuenta). */
export function bucketKey(env: Env): string {
  const k = (env.APS_BUCKET || `agelarq-${(env.APS_CLIENT_ID || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}`)
    .toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
  if (!/^[-_.a-z0-9]{3,128}$/.test(k)) throw new HttpError(500, 'APS_BUCKET inválido (3 a 128 caracteres: a-z, 0-9, - _ .)');
  return k;
}

/** Nombre de archivo seguro para la llave del objeto. */
export function safeName(n: string): string {
  const s = String(n || 'modelo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return (s || 'modelo').slice(0, 120);
}

type Tok = { token: string; exp: number };

export class Aps {
  private cache = new Map<string, Tok>();
  private base: string;
  constructor(private env: Env, private f: Fetch) { this.base = (env.APS_BASE_URL || BASE).replace(/\/+$/, ''); }

  async token(scopes: string): Promise<{ access_token: string; expires_in: number }> {
    const c = this.cache.get(scopes);
    const now = Date.now();
    if (c && c.exp - now > 60_000) return { access_token: c.token, expires_in: Math.floor((c.exp - now) / 1000) };
    const basic = btoa(`${this.env.APS_CLIENT_ID}:${this.env.APS_CLIENT_SECRET}`);
    const res = await this.f(`${this.base}/authentication/v2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: scopes }).toString(),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApsError(res.status, res.status === 401 ? 'Autodesk rechazó las credenciales (revisa APS_CLIENT_ID y APS_CLIENT_SECRET)' : 'No se obtuvo token de Autodesk', JSON.stringify(d).slice(0, 300));
    this.cache.set(scopes, { token: d.access_token, exp: now + d.expires_in * 1000 });
    return { access_token: d.access_token, expires_in: d.expires_in };
  }

  private async call(method: string, path: string, scopes: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
    const { access_token } = await this.token(scopes);
    const res = await this.f(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${access_token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { status: res.status, ok: res.ok, data };
  }

  async ensureBucket(key: string) {
    const r = await this.call('POST', '/oss/v2/buckets', 'bucket:create bucket:read', { body: { bucketKey: key, policyKey: 'persistent' } });
    if (r.ok || r.status === 409) return;           // 409: ya existe (de esta cuenta)
    if (r.status === 403) throw new ApsError(403, 'El bucket de Autodesk pertenece a otra cuenta: define APS_BUCKET con otro nombre');
    throw new ApsError(r.status, 'No se pudo preparar el almacenamiento de Autodesk', JSON.stringify(r.data).slice(0, 300));
  }

  async signedUpload(bucket: string, key: string, parts: number, firstPart: number, uploadKey?: string) {
    const q = new URLSearchParams({ parts: String(parts), firstPart: String(firstPart), minutesExpiration: '60' });
    if (uploadKey) q.set('uploadKey', uploadKey);
    const r = await this.call('GET', `/oss/v2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}/signeds3upload?${q}`, 'data:write data:create');
    if (!r.ok) throw new ApsError(r.status, 'Autodesk no entregó las direcciones de subida', JSON.stringify(r.data).slice(0, 300));
    return { uploadKey: r.data.uploadKey as string, urls: r.data.urls as string[] };
  }

  async completeUpload(bucket: string, key: string, uploadKey: string) {
    const r = await this.call('POST', `/oss/v2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}/signeds3upload`,
      'data:write data:create', { body: { uploadKey } });
    if (!r.ok) throw new ApsError(r.status, 'Autodesk no pudo cerrar la subida (¿se subieron todas las partes?)', JSON.stringify(r.data).slice(0, 300));
    return r.data as { objectId: string; size?: number };
  }

  async translate(urn: string, rootFilename?: string) {
    const input: Record<string, unknown> = { urn };
    if (rootFilename) { input.compressedUrn = true; input.rootFilename = rootFilename; }
    const r = await this.call('POST', '/modelderivative/v2/designdata/job', 'data:read data:write data:create',
      { body: { input, output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] } }, headers: { 'x-ads-force': 'true' } });
    if (!r.ok) throw new ApsError(r.status, 'Autodesk no aceptó la conversión', JSON.stringify(r.data).slice(0, 300));
    return r.data;
  }

  async manifest(urn: string) {
    const r = await this.call('GET', `/modelderivative/v2/designdata/${urn}/manifest`, 'data:read viewables:read');
    if (r.status === 404) return null;
    if (!r.ok) throw new ApsError(r.status, 'No se pudo consultar la conversión', JSON.stringify(r.data).slice(0, 300));
    return r.data as { status: string; progress?: string; derivatives?: Array<{ status?: string; messages?: Array<{ type: string; message?: string; code?: string }> }> };
  }
}

/** Traduce un manifiesto de Model Derivative a nuestro estado. */
export function manifestState(m: Awaited<ReturnType<Aps['manifest']>>) {
  if (!m) return { status: 'translating' as const, progress: '0%', messages: [] as unknown[] };
  const messages = (m.derivatives || []).flatMap(d => d.messages || []).filter(x => x.type === 'error' || x.type === 'warning')
    .slice(0, 20).map(x => ({ type: x.type, code: x.code || '', message: String(x.message || '').slice(0, 500) }));
  const s = String(m.status || '').toLowerCase();
  if (s === 'success') return { status: 'ready' as const, progress: '100%', messages };
  if (s === 'failed' || s === 'timeout') return { status: 'failed' as const, progress: m.progress || '', messages: messages.length ? messages : [{ type: 'error', code: s, message: 'La conversión falló en Autodesk' }] };
  return { status: 'translating' as const, progress: (m.progress || '').replace(/\s*complete/i, ''), messages };
}

export function apsErrorResponse(e: unknown) {
  if (e instanceof ApsError) { console.error('APS', e.status, e.message, e.detail); return new HttpError(502, e.message); }
  return e;
}
