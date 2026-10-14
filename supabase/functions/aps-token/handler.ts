// aps-token · token de lectura limitado a un único modelo autorizado.
// Cuerpo: { model_version_id }. Solo si el usuario puede ver el proyecto y la
// conversión terminó. Nunca entrega un token con permisos de escritura.
import { Env, Fetch, HttpError, json, need, serve, bearer, uuidParam, versionAccess } from '../_shared/http.ts';
import { Aps, apsErrorResponse, urnOf } from '../_shared/aps.ts';

// APS OAuth v2 admite data:read:<raw object URN>. Nunca combinar con scopes globales.
function viewerScope(urn: string): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(urn)) throw new Error();
    const raw = atob(urn.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - urn.length % 4) % 4));
    if (!/^urn:adsk\.objects:os\.object:[a-z0-9_.-]+\/[A-Za-z0-9_./%:-]+$/.test(raw) || urnOf(raw) !== urn) throw new Error();
    return `data:read:${raw}`;
  } catch (_) { throw new HttpError(409, 'La referencia del modelo no es válida; vuelve a convertirlo'); }
}

export function handler(env: Env, f: Fetch) {
  const aps = new Aps(env, f);
  return serve(async (req, body) => {
    need(env, 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'APS_CLIENT_ID', 'APS_CLIENT_SECRET');
    const token = bearer(req);
    const id = uuidParam(body.model_version_id, 'model_version_id');
    const v = await versionAccess(env, f, token, id);
    if (v.status !== 'ready' || !v.aps_urn) throw new HttpError(409, 'El modelo aún no está listo para verse');
    try {
      const t = await aps.token(viewerScope(v.aps_urn));
      return json({ access_token: t.access_token, expires_in: t.expires_in, urn: v.aps_urn });
    } catch (e) { throw apsErrorResponse(e); }
  });
}
