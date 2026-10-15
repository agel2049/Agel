// aps-status · consulta la conversión en Autodesk y actualiza la versión.
// Cuerpo: { model_version_id }. Cualquier miembro del proyecto puede consultar.
import { Env, Fetch, json, need, serve, bearer, uuidParam, versionAccess, setVersion } from '../_shared/http.ts';
import { Aps, manifestState, apsErrorResponse } from '../_shared/aps.ts';

export function handler(env: Env, f: Fetch) {
  const aps = new Aps(env, f);
  return serve(async (req, body) => {
    need(env, 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APS_CLIENT_ID', 'APS_CLIENT_SECRET');
    const token = bearer(req);
    const id = uuidParam(body.model_version_id, 'model_version_id');
    const v = await versionAccess(env, f, token, id);
    if (!v.aps_urn || v.status === 'ready') return json({ status: v.status });
    try {
      const st = manifestState(await aps.manifest(v.aps_urn));
      await setVersion(env, f, id, st);
      return json(st);
    } catch (e) { throw apsErrorResponse(e); }
  });
}
