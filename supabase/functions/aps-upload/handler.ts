// aps-upload · entrega URLs firmadas de S3 para subir un modelo directo a Autodesk.
// Cuerpo: { model_version_id, parts, first_part?, upload_key? }
// Respuesta: { upload_key, urls[] }. Solo propietario o editor del proyecto.
import { Env, Fetch, HttpError, json, need, serve, bearer, uuidParam, versionAccess, setVersion } from '../_shared/http.ts';
import { Aps, bucketKey, safeName, apsErrorResponse } from '../_shared/aps.ts';

export const MAX_PARTS_PER_CALL = 25;

export function handler(env: Env, f: Fetch) {
  const aps = new Aps(env, f);
  return serve(async (req, body) => {
    need(env, 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APS_CLIENT_ID', 'APS_CLIENT_SECRET');
    const token = bearer(req);
    const id = uuidParam(body.model_version_id, 'model_version_id');
    const parts = Number(body.parts), first = Number(body.first_part ?? 1);
    if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS_PER_CALL) throw new HttpError(400, `parts debe ser de 1 a ${MAX_PARTS_PER_CALL}`);
    if (!Number.isInteger(first) || first < 1 || first > 10000) throw new HttpError(400, 'first_part inválido');
    const uploadKey = typeof body.upload_key === 'string' && body.upload_key ? body.upload_key.slice(0, 2000) : undefined;
    const v = await versionAccess(env, f, token, id);
    if (!v.can_edit) throw new HttpError(403, 'Solo el propietario o un editor suben modelos');
    if (!['pending', 'uploading', 'failed'].includes(v.status)) throw new HttpError(409, 'Esta versión ya se subió; crea una versión nueva');
    if (uploadKey && !v.aps_object_key) throw new HttpError(409, 'La subida no se inició correctamente; vuelve a intentarlo');
    const bucket = v.aps_bucket || bucketKey(env);
    const key = uploadKey ? v.aps_object_key! : `${v.project_id}/${v.model_id}/v${v.version}/${safeName(v.source_name)}`;
    try {
      if (!uploadKey) await aps.ensureBucket(bucket);
      const r = await aps.signedUpload(bucket, key, parts, first, uploadKey);
      if (!uploadKey) await setVersion(env, f, id, { status: 'uploading', aps_bucket: bucket, aps_object_key: key, aps_urn: null, progress: '', messages: [] });
      return json({ upload_key: r.uploadKey, urls: r.urls });
    } catch (e) { throw apsErrorResponse(e); }
  });
}
