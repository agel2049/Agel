// Pruebas de las funciones de servidor sin red: Supabase y Autodesk simulados.
// Uso: deno test supabase/functions/tests/
import { assert, assertEquals, assertMatch } from './assert.ts';
import { handler as upload } from '../aps-upload/handler.ts';
import { handler as translate } from '../aps-translate/handler.ts';
import { handler as status } from '../aps-status/handler.ts';
import { handler as token } from '../aps-token/handler.ts';
import { handler as notify, safeWebhook } from '../lead-notify/handler.ts';
import { urnOf, manifestState } from '../_shared/aps.ts';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-secreta',
              APS_CLIENT_ID: 'AbC123xyz', APS_CLIENT_SECRET: 'aps-secreto-NO-SALE' };
const V = '11111111-2222-4333-8444-555555555555';
const base = { id: V, project_id: 'p1', model_id: 'm1', version: 3, source_name: 'Torre Ñandú.nwd', source_bytes: 1000,
               aps_bucket: null, aps_object_key: null, aps_urn: null };

type Call = { method: string; url: string; headers: Record<string, string>; body: string };
function world(opts: { access?: Record<string, unknown>; manifest?: unknown; webhookStatus?: number } = {}) {
  const calls: Call[] = [];
  const access: Record<string, unknown> = opts.access || {};
  const f = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input), method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ method, url, headers, body });
    const J = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/rest/v1/rpc/model_version_access')) {
      const t = (headers.authorization || '').replace('Bearer ', '');
      return J(t in access ? access[t] : null);
    }
    if (url.startsWith('https://db.test/rest/v1/model_versions')) return new Response(null, { status: 204 });
    if (url.endsWith('/rest/v1/rpc/pending_lead_notifications')) return J([
      { lead_id: 'L1', project_id: 'p1', project_name: 'Torre', notify_email: 'ventas@estudio.mx', webhook: 'https://crm.example.com/hook',
        name: 'Laura', email: 'laura@correo.mx', phone: '', message: 'Hola', space_label: 'Depto 101', source: { utm_source: 'facebook' }, created_at: '2026-10-13' },
      { lead_id: 'L2', project_id: 'p1', project_name: 'Torre', notify_email: null, webhook: 'https://192.168.1.10/hook',
        name: 'Robo', email: 'x@y.mx', phone: '', message: '', space_label: '', source: {}, created_at: '2026-10-13' }]);
    if (url.endsWith('/rest/v1/rpc/mark_lead_notified')) return new Response(null, { status: 204 });
    if (url.endsWith('/authentication/v2/token')) {
      const scope = new URLSearchParams(body).get('scope');
      return J({ access_token: `tok:${scope}`, token_type: 'Bearer', expires_in: 3599 });
    }
    if (url.endsWith('/oss/v2/buckets') && method === 'POST') return J({ reason: 'exists' }, 409);
    if (url.includes('/signeds3upload') && method === 'GET') return J({ uploadKey: 'UK-1', urls: ['https://s3.test/1', 'https://s3.test/2'] });
    if (url.includes('/signeds3upload') && method === 'POST') {
      const key = decodeURIComponent(url.split('/objects/')[1].split('/signeds3upload')[0]);
      return J({ objectId: `urn:adsk.objects:os.object:bk/${key}`, size: 1000 });
    }
    if (url.endsWith('/modelderivative/v2/designdata/job')) return J({ result: 'created' });
    if (url.includes('/manifest')) return opts.manifest === undefined ? J({}, 404) : J(opts.manifest);
    if (url === 'https://crm.example.com/hook') return new Response('', { status: opts.webhookStatus || 200 });
    if (url === 'https://api.resend.com/emails') return J({ id: 'e1' });
    return new Response('no simulado: ' + url, { status: 599 });
  };
  return { f: f as typeof fetch, calls };
}
const post = (body: unknown, tok?: string, extra: Record<string, string> = {}) =>
  new Request('https://fn.test/', { method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...extra } });

Deno.test('sin sesión responde 401', async () => {
  const w = world();
  const r = await upload(ENV, w.f)(post({ model_version_id: V, parts: 1 }));
  assertEquals(r.status, 401);
});

Deno.test('faltan secretos: mensaje claro', async () => {
  const w = world();
  const r = await upload({ ...ENV, APS_CLIENT_SECRET: undefined }, w.f)(post({ model_version_id: V, parts: 1 }, 'x'));
  assertEquals(r.status, 500);
  assertMatch((await r.json()).error, /APS_CLIENT_SECRET/);
});

Deno.test('un lector no puede subir', async () => {
  const w = world({ access: { lector: { ...base, status: 'pending', role: 'viewer', can_edit: false } } });
  const r = await upload(ENV, w.f)(post({ model_version_id: V, parts: 1 }, 'lector'));
  assertEquals(r.status, 403);
  assert(!w.calls.some(c => c.url.includes('autodesk')), 'llamó a Autodesk sin permiso');
});

Deno.test('versión ajena: 404', async () => {
  const w = world({ access: {} });
  const r = await token(ENV, w.f)(post({ model_version_id: V }, 'otro'));
  assertEquals(r.status, 404);
});

Deno.test('editor obtiene URLs firmadas y la versión queda subiendo', async () => {
  const w = world({ access: { edi: { ...base, status: 'pending', role: 'editor', can_edit: true } } });
  const r = await upload(ENV, w.f)(post({ model_version_id: V, parts: 2 }, 'edi'));
  assertEquals(r.status, 200);
  const d = await r.json();
  assertEquals(d, { upload_key: 'UK-1', urls: ['https://s3.test/1', 'https://s3.test/2'] });
  const get = w.calls.find(c => c.url.includes('/signeds3upload'))!;
  assertMatch(get.url, /buckets\/agelarq-abc123xyz\/objects\/p1%2Fm1%2Fv3%2FTorre_Nandu\.nwd\/signeds3upload\?parts=2&firstPart=1&minutesExpiration=60/);
  const patch = w.calls.find(c => c.method === 'PATCH')!;
  assertEquals(patch.headers.authorization, 'Bearer service-secreta');
  assertEquals(JSON.parse(patch.body).status, 'uploading');
  const tokCall = w.calls.find(c => c.url.endsWith('/authentication/v2/token'))!;
  assertEquals(tokCall.headers.authorization, 'Basic ' + btoa('AbC123xyz:aps-secreto-NO-SALE'));
  assert(!JSON.stringify(d).includes('secreto'), 'el secreto salió en la respuesta');
});

Deno.test('más de 25 partes por llamada se rechaza', async () => {
  const w = world({ access: { edi: { ...base, status: 'pending', role: 'editor', can_edit: true } } });
  const r = await upload(ENV, w.f)(post({ model_version_id: V, parts: 26 }, 'edi'));
  assertEquals(r.status, 400);
});

Deno.test('una versión ya convertida no se vuelve a subir', async () => {
  const w = world({ access: { edi: { ...base, status: 'ready', role: 'editor', can_edit: true } } });
  assertEquals((await upload(ENV, w.f)(post({ model_version_id: V, parts: 1 }, 'edi'))).status, 409);
});

Deno.test('convertir: cierra la subida y pide SVF2 con x-ads-force', async () => {
  const acc = { ...base, status: 'uploading', aps_bucket: 'bk', aps_object_key: 'p1/m1/v3/Torre.nwd', role: 'owner', can_edit: true };
  const w = world({ access: { own: acc } });
  const r = await translate(ENV, w.f)(post({ model_version_id: V, upload_key: 'UK-1' }, 'own'));
  assertEquals(r.status, 200);
  const d = await r.json();
  assertEquals(d.urn, urnOf('urn:adsk.objects:os.object:bk/p1/m1/v3/Torre.nwd'));
  assert(!/[+/=]/.test(d.urn), 'la URN no es url-safe');
  const job = w.calls.find(c => c.url.endsWith('/designdata/job'))!;
  assertEquals(job.headers['x-ads-force'], 'true');
  assertEquals(JSON.parse(job.body).output.formats[0], { type: 'svf2', views: ['2d', '3d'] });
  const done = w.calls.find(c => c.method === 'POST' && c.url.includes('/signeds3upload'))!;
  assertEquals(JSON.parse(done.body), { uploadKey: 'UK-1' });
  assertEquals(JSON.parse(w.calls.filter(c => c.method === 'PATCH').pop()!.body).status, 'translating');
});

Deno.test('un .zip necesita archivo principal', async () => {
  const acc = { ...base, source_name: 'modelo.zip', status: 'uploading', aps_bucket: 'bk', aps_object_key: 'k', role: 'owner', can_edit: true };
  const w = world({ access: { own: acc } });
  assertEquals((await translate(ENV, w.f)(post({ model_version_id: V, upload_key: 'UK' }, 'own'))).status, 400);
});

Deno.test('estado: éxito → listo; falla → mensajes', async () => {
  const acc = { ...base, status: 'translating', aps_urn: 'dXJu', role: 'viewer', can_edit: false };
  let w = world({ access: { v: acc }, manifest: { status: 'success', progress: 'complete' } });
  let d = await (await status(ENV, w.f)(post({ model_version_id: V }, 'v'))).json();
  assertEquals(d.status, 'ready');
  w = world({ access: { v: acc }, manifest: { status: 'failed', derivatives: [{ messages: [{ type: 'error', code: 'TranslationWorker-InternalFailure', message: 'Unrecoverable exit code' }] }] } });
  d = await (await status(ENV, w.f)(post({ model_version_id: V }, 'v'))).json();
  assertEquals(d.status, 'failed');
  assertEquals(d.messages[0].code, 'TranslationWorker-InternalFailure');
  assertEquals(manifestState({ status: 'inprogress', progress: '45% complete' }).progress, '45%');
});

Deno.test('token del visor: cada recurso autorizado obtiene un scope exclusivo', async () => {
  const raw1 = 'urn:adsk.objects:os.object:bk/p1/modelo.nwd';
  const raw2 = 'urn:adsk.objects:os.object:bk/p2/modelo.nwd';
  const access = (raw: string) => ({ ...base, status: 'ready', aps_urn: urnOf(raw), role: 'viewer', can_edit: false });
  const w = world({ access: { uno: access(raw1), dos: access(raw2),
    pendiente: { ...access(raw1), status: 'translating' } } });
  const h = token(ENV, w.f);
  assertEquals((await h(post({ model_version_id: V }, 'pendiente'))).status, 409);
  assertEquals((await h(post({ model_version_id: V }, 'ajeno'))).status, 404);
  const a = await (await h(post({ model_version_id: V, scope: 'data:read' }, 'uno'))).json();
  const b = await (await h(post({ model_version_id: V }, 'dos'))).json();
  assertEquals(a, { access_token: `tok:data:read:${raw1}`, expires_in: 3599, urn: urnOf(raw1) });
  assertEquals(b.access_token, `tok:data:read:${raw2}`);
  const scopes = w.calls.filter(c => c.url.endsWith('/authentication/v2/token')).map(c => new URLSearchParams(c.body).get('scope'));
  assertEquals(scopes, [`data:read:${raw1}`, `data:read:${raw2}`]);
});

Deno.test('token del visor: rechaza URN malformadas o con inyección de scopes', async () => {
  for (const urn of ['dXJu', urnOf('urn:adsk.objects:os.object:bk/a data:read'), urnOf('urn:adsk.objects:os.object:bk/*')]) {
    const w = world({ access: { v: { ...base, status: 'ready', aps_urn: urn, role: 'viewer', can_edit: false } } });
    const r = await token(ENV, w.f)(post({ model_version_id: V }, 'v'));
    assertEquals(r.status, 409);
    assert(!w.calls.some(c => c.url.endsWith('/authentication/v2/token')), 'se pidió OAuth con URN inválida');
  }
});

Deno.test('webhook: solo https a dominios públicos', () => {
  for (const bad of ['http://crm.example.com/h', 'https://localhost/h', 'https://127.0.0.1/h', 'https://10.0.0.5/h', 'https://192.168.1.1/h',
                     'https://172.20.0.1/h', 'https://169.254.169.254/latest', 'https://[::1]/h', 'https://intranet/h', 'https://a.example.com:8443/h',
                     'https://user:pw@a.example.com/h', 'javascript:alert(1)'])
    assertEquals(safeWebhook(bad), null, bad);
  assert(safeWebhook('https://hooks.zapier.com/hooks/catch/1/abc') !== null);
});

Deno.test('avisos de prospectos: autorización, webhook firmado, correo e idempotencia', async () => {
  const env = { ...ENV, RESEND_API_KEY: 're_x', NOTIFY_FROM: 'Avisos <avisos@estudio.mx>', WEBHOOK_SECRET: 'firma' };
  let w = world();
  assertEquals((await notify(env, w.f)(post({}, 'anon'))).status, 401);
  w = world();
  const r = await notify(env, w.f)(post({ type: 'INSERT' }, 'service-secreta'));
  const d = await r.json();
  assertEquals(d.procesados, 2);
  assertEquals(d.resultados[0], { lead: 'L1', webhook: 'ok', email: 'ok' });
  assertMatch(d.resultados[1].webhook, /rechazado/);
  assert(!w.calls.some(c => c.url.includes('192.168')), 'se llamó a una IP privada');
  const hook = w.calls.find(c => c.url === 'https://crm.example.com/hook')!;
  assertMatch(hook.headers['x-agel-signature'], /^sha256=[0-9a-f]{64}$/);
  const mail = JSON.parse(w.calls.find(c => c.url === 'https://api.resend.com/emails')!.body);
  assertEquals(mail.reply_to, 'laura@correo.mx');
  const marks = w.calls.filter(c => c.url.endsWith('mark_lead_notified')).map(c => JSON.parse(c.body).p_lead);
  assertEquals(marks, ['L1']);                       // L2 no se entregó: queda pendiente
  w = world({ webhookStatus: 500 });
  const r2 = await (await notify({ ...ENV }, w.f)(post({}, 'service-secreta'))).json();
  assertEquals(r2.resultados[0].webhook, 'HTTP 500');
  assertMatch(r2.resultados[0].email, /sin configurar/);
  assert(!w.calls.some(c => c.url.endsWith('mark_lead_notified')), 'marcó como avisado sin entregar');
});
