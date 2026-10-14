// AgelArq · utilidades comunes de las funciones de servidor (Supabase Edge Functions).
// Sin dependencias externas: solo fetch. Las variables SUPABASE_URL,
// SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las pone Supabase solo.

export type Env = Record<string, string | undefined>;
export type Fetch = typeof fetch;

export const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** Envuelve un manejador: CORS, solo POST, JSON y errores legibles. */
export function serve(fn: (req: Request, body: Record<string, unknown>) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Usa POST' }, 405);
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { return json({ error: 'Cuerpo JSON inválido' }, 400); }
    try { return await fn(req, body || {}); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Error interno de la función' }, 500);
    }
  };
}

export function need(env: Env, ...keys: string[]) {
  const miss = keys.filter(k => !env[k]);
  if (miss.length) throw new HttpError(500, `Falta configurar en Supabase (Edge Functions → Secrets): ${miss.join(', ')}`);
}

export function bearer(req: Request): string {
  const h = req.headers.get('authorization') || '';
  const t = h.replace(/^Bearer\s+/i, '').trim();
  if (!t) throw new HttpError(401, 'Inicia sesión');
  return t;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidParam(v: unknown, name: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, `${name} inválido`);
  return v.toLowerCase();
}

/** Llama a una función RPC de la base con el token del usuario (aplica sus permisos). */
export async function rpcAsUser<T>(env: Env, f: Fetch, token: string, fn: string, args: unknown): Promise<T> {
  const res = await f(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (res.status === 401) throw new HttpError(401, 'Tu sesión venció; vuelve a entrar');
  if (!res.ok) throw new HttpError(res.status === 403 ? 403 : 400, (safeJson(text) as { message?: string })?.message || 'Error de la base');
  return safeJson(text) as T;
}

/** Escribe con la clave de servicio (solo el servidor la tiene). */
export async function serviceRest(env: Env, f: Fetch, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await f(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
               'Content-Type': 'application/json', Prefer: 'return=minimal', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Base (${res.status}): ${text.slice(0, 300)}`);
  return safeJson(text);
}

export function safeJson(t: string): unknown { try { return t ? JSON.parse(t) : null; } catch (_) { return null; } }

export type VersionAccess = {
  id: string; project_id: string; model_id: string; version: number; source_name: string; source_bytes: number | null;
  status: 'pending' | 'uploading' | 'translating' | 'ready' | 'failed';
  aps_bucket: string | null; aps_object_key: string | null; aps_urn: string | null; role: string; can_edit: boolean;
};

/** Qué puede hacer el usuario con una versión del modelo (404 si no la ve). */
export async function versionAccess(env: Env, f: Fetch, token: string, id: string): Promise<VersionAccess> {
  const a = await rpcAsUser<VersionAccess | null>(env, f, token, 'model_version_access', { p_version: id });
  if (!a) throw new HttpError(404, 'La versión no existe o no tienes acceso');
  return a;
}

export async function setVersion(env: Env, f: Fetch, id: string, patch: Record<string, unknown>) {
  await serviceRest(env, f, `model_versions?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
