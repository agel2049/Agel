// Sirve todas las funciones en un puerto local (pruebas de extremo a extremo).
// deno run --allow-net --allow-env supabase/functions/tests/serve_local.ts <puerto>
import { handler as upload } from '../aps-upload/handler.ts';
import { handler as translate } from '../aps-translate/handler.ts';
import { handler as status } from '../aps-status/handler.ts';
import { handler as token } from '../aps-token/handler.ts';
import { handler as notify } from '../lead-notify/handler.ts';

const env = Deno.env.toObject();
const routes: Record<string, (r: Request) => Promise<Response>> = {
  'aps-upload': upload(env, fetch), 'aps-translate': translate(env, fetch), 'aps-status': status(env, fetch),
  'aps-token': token(env, fetch), 'lead-notify': notify(env, fetch),
};
const port = Number(Deno.args[0] || 54400);
Deno.serve({ port, hostname: '127.0.0.1', onListen: () => console.log(`funciones en ${port}`) }, req => {
  const name = new URL(req.url).pathname.replace(/^\/+/, '').split('/')[0];
  const fn = routes[name];
  return fn ? fn(req) : new Response('no existe', { status: 404 });
});
