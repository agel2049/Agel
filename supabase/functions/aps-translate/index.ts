// Punto de entrada para Supabase Edge Functions. La lógica está en handler.ts
// (separada para poder probarla sin red: supabase/functions/tests).
import { handler } from './handler.ts';
Deno.serve(handler(Deno.env.toObject(), fetch));
