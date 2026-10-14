// aps-translate · cierra la subida y pide la conversión a SVF2.
// Cuerpo: { model_version_id, upload_key, root_filename? }  (root_filename solo para .zip)
import { Env, Fetch, HttpError, json, need, serve, bearer, uuidParam, versionAccess, setVersion } from '../_shared/http.ts';
import { Aps, urnOf, apsErrorResponse } from '../_shared/aps.ts';

export function handler(env: Env, f: Fetch) {
  const aps = new Aps(env, f);
  return serve(async (req, body) => {
    need(env, 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APS_CLIENT_ID', 'APS_CLIENT_SECRET');
    const token = bearer(req);
    const id = uuidParam(body.model_version_id, 'model_version_id');
    const uploadKey = typeof body.upload_key === 'string' ? body.upload_key.slice(0, 2000) : '';
    if (!uploadKey) throw new HttpError(400, 'Falta upload_key');
    const v = await versionAccess(env, f, token, id);
    if (!v.can_edit) throw new HttpError(403, 'Solo el propietario o un editor convierten modelos');
    if (v.status !== 'uploading' || !v.aps_bucket || !v.aps_object_key) throw new HttpError(409, 'Esta versión no tiene una subida en curso');
    const isZip = /\.zip$/i.test(v.source_name || '');
    const root = typeof body.root_filename === 'string' ? body.root_filename.slice(0, 255) : '';
    if (isZip && !root) throw new HttpError(400, 'Para un .zip indica el archivo principal (root_filename)');
    try {
      const obj = await aps.completeUpload(v.aps_bucket, v.aps_object_key, uploadKey);
      const urn = urnOf(obj.objectId);
      await aps.translate(urn, isZip ? root : undefined);
      await setVersion(env, f, id, { status: 'translating', aps_urn: urn, progress: '0%', messages: [] });
      return json({ status: 'translating', urn });
    } catch (e) {
      const err = apsErrorResponse(e);
      if (err instanceof HttpError) await setVersion(env, f, id, { status: 'failed', messages: [{ type: 'error', message: err.message }] }).catch(() => {});
      throw err;
    }
  });
}
