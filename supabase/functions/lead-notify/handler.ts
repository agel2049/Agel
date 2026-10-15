// lead-notify · avisa de prospectos nuevos por correo (Resend) y/o webhook de CRM.
// Se llama desde un Database Webhook de Supabase (INSERT en public.leads) o
// desde una tarea programada. Procesa todos los pendientes y marca cada uno
// como avisado (notified_at), así un reintento no duplica avisos.
// Autorización: clave de servicio en Authorization o el secreto LEAD_NOTIFY_SECRET
// en la cabecera x-agel-secret.
// Secretos opcionales: RESEND_API_KEY + NOTIFY_FROM (correo), WEBHOOK_SECRET (firma HMAC).
import { Env, Fetch, HttpError, json, need, serve, serviceRest } from '../_shared/http.ts';

type Pending = { lead_id: string; project_id: string; project_name: string; notify_email: string | null; webhook: string | null;
  name: string; email: string; phone: string; message: string; space_label: string; source: Record<string, unknown>; created_at: string };

/** Solo https a nombres públicos: nada de localhost, IP privadas ni puertos raros (evita SSRF). */
export function safeWebhook(u: string | null): URL | null {
  if (!u) return null;
  let url: URL; try { url = new URL(u); } catch (_) { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return null;
  }
  if (host.includes(':')) return null;                       // IPv6 literal: no se permite
  return url;
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function authorized(req: Request, env: Env) {
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (env.SUPABASE_SERVICE_ROLE_KEY && auth === env.SUPABASE_SERVICE_ROLE_KEY) return true;
  const s = req.headers.get('x-agel-secret');
  return !!(env.LEAD_NOTIFY_SECRET && s && s === env.LEAD_NOTIFY_SECRET);
}

export function handler(env: Env, f: Fetch) {
  return serve(async (req) => {
    need(env, 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
    if (!authorized(req, env)) throw new HttpError(401, 'No autorizado');
    const pending = await serviceRest(env, f, 'rpc/pending_lead_notifications', { method: 'POST', body: JSON.stringify({ p_limit: 50 }),
      headers: { Prefer: 'return=representation' } }) as Pending[] || [];
    const results: Array<{ lead: string; email?: string; webhook?: string }> = [];
    for (const l of pending) {
      const r: { lead: string; email?: string; webhook?: string } = { lead: l.lead_id };
      let delivered = false;
      const payload = { event: 'lead.created', project: { id: l.project_id, name: l.project_name },
        lead: { id: l.lead_id, name: l.name, email: l.email, phone: l.phone, message: l.message, interest: l.space_label,
                selection: Array.isArray(l.source?.seleccion) ? l.source.seleccion : [],
                source: l.source, created_at: l.created_at } };
      const hook = safeWebhook(l.webhook);
      if (l.webhook && !hook) r.webhook = 'rechazado (solo https a dominios públicos)';
      if (hook) {
        const body = JSON.stringify(payload);
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'AgelArq-Leads/1' };
        if (env.WEBHOOK_SECRET) headers['x-agel-signature'] = 'sha256=' + await hmac(env.WEBHOOK_SECRET, body);
        try {
          const res = await f(hook.href, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(6000) });
          r.webhook = res.ok ? 'ok' : `HTTP ${res.status}`; delivered ||= res.ok;
        } catch (e) { r.webhook = 'sin respuesta'; }
      }
      if (l.notify_email && env.RESEND_API_KEY && env.NOTIFY_FROM) {
        const text = [`Nuevo prospecto en ${l.project_name}`, '', `Nombre: ${l.name}`, `Correo: ${l.email}`, l.phone ? `Teléfono: ${l.phone}` : '',
          l.space_label ? `Interés: ${l.space_label}` : '',
          Array.isArray(l.source?.seleccion) && l.source.seleccion.length ? `Su selección: ${(l.source.seleccion as string[]).join(', ')}` : '',
          l.message ? `\nMensaje:\n${l.message}` : '',
          `\nOrigen: ${[l.source?.utm_source, l.source?.utm_campaign].filter(Boolean).join(' / ') || l.source?.referrer || 'directo'}`,
          '', 'Responde directamente a este correo para escribirle.'].filter(x => x !== '').join('\n');
        try {
          const res = await f('https://api.resend.com/emails', { method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: env.NOTIFY_FROM, to: [l.notify_email], reply_to: l.email,
                                   subject: `Nuevo prospecto: ${l.name} (${l.project_name})`.slice(0, 200), text }) });
          r.email = res.ok ? 'ok' : `HTTP ${res.status}`; delivered ||= res.ok;
        } catch (_) { r.email = 'sin respuesta'; }
      } else if (l.notify_email) r.email = 'sin configurar (RESEND_API_KEY / NOTIFY_FROM)';
      if (delivered) await serviceRest(env, f, 'rpc/mark_lead_notified', { method: 'POST', body: JSON.stringify({ p_lead: l.lead_id }) });
      results.push(r);
    }
    return json({ procesados: results.length, resultados: results });
  });
}
