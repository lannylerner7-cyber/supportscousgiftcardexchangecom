import { queryOne } from "./d1.server";
import { draining } from "./observability.server";
let expires = 0;
let pending: Promise<boolean> | undefined;
/** Cache both success and failure; coalesce concurrent probes, never scan a table. */
export async function databaseReady() {
  if (draining) return false;
  if (!pending || Date.now() >= expires) {
    expires = Date.now() + 15000;
    pending = queryOne("SELECT 1 AS ready").then(() => true, () => false);
  }
  return pending;
}
