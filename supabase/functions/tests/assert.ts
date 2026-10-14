// Aserciones mínimas (sin descargar la biblioteca estándar de Deno).
export function assert(cond: unknown, msg = 'aserción fallida'): asserts cond {
  if (!cond) throw new Error(msg);
}
export function assertEquals(a: unknown, b: unknown, msg = '') {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg ? msg + ': ' : ''}esperaba ${sb}\n  obtuve  ${sa}`);
}
export function assertMatch(s: string, re: RegExp) {
  if (!re.test(String(s))) throw new Error(`"${s}" no coincide con ${re}`);
}
