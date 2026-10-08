import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<{ id: string }>();
const totals = new Map<string, { count: number; errors: number; ms: number; max: number; buckets: number[] }>();
/** Fixed event names only; never SQL, URLs, user IDs, payloads or provider errors. */
export function measure(event: "request" | "d1" | "delivery", ms: number, ok: boolean) {
  const total = totals.get(event) ?? { count: 0, errors: 0, ms: 0, max: 0, buckets: [0,0,0,0,0,0] };
  total.count++; total.errors += ok ? 0 : 1; total.ms += ms; total.max = Math.max(total.max, ms);
  const bucket = [10,50,100,500,1000,Infinity].findIndex(bound=>ms<=bound);
  total.buckets[bucket] = (total.buckets[bucket] ?? 0) + 1;
  totals.set(event, total);
  if (!ok || ms > 1000 || total.count % 100 === 0)
    console.info(JSON.stringify({ event, correlation: context.getStore()?.id, duration_ms: Math.round(ms), ok, ...total }));
}
export function correlated<T>(fn: () => Promise<T>) {
  return context.run({ id: crypto.randomUUID() }, fn);
}
let active = 0;
export let draining = false;
export function beginDrain() { draining = true; }
export async function observedRequest(fn: () => Promise<Response>) {
  return correlated(async () => {
    if (draining || active >= 128) {
      measure("request", 0, false);
      return new Response("Temporarily busy", {
        status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store",
          "X-Request-ID": context.getStore()!.id },
      });
    }
    active++;
    const start = performance.now();
    let ok = false;
    try {
      const response = await fn();
      ok = response.status < 500;
      response.headers.set("X-Request-ID", context.getStore()!.id);
      return response;
    } finally { active--; measure("request", performance.now() - start, ok); }
  });
}
