import { openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { statements, sql, sha256, warning, manifest, runImport, createTransport } from "./support-import.mjs";
export { statements };

export async function main(args = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({ args, options: {
    apply: { type: "boolean" }, "dry-run": { type: "boolean" },
    "confirm-target": { type: "string" }, "confirm-sha256": { type: "string" },
    "accept-database-block": { type: "boolean" }, "recovery-file": { type: "string" },
  } });
  if (values.apply && values["dry-run"]) throw Error("Choose dry-run or apply, not both.");
  console.log(warning);
  console.log(`SQL SHA256: ${sha256}\nObjects: ${manifest.catalog.map(o => `${o.type}:${o.name}`).join(", ")}`);
  if (!values.apply) {
    console.log(`Dry run: no database accessed. Review this complete SQL file:\n${sql}`);
    console.log("Apply requires --confirm-target ACCOUNT_ID/DATABASE_ID --confirm-sha256 HASH --accept-database-block --recovery-file NEW_PRIVATE_PATH");
    return;
  }
  const account = env.CLOUDFLARE_ACCOUNT_ID, database = env.D1_DATABASE_ID;
  if (!/^[a-f0-9]{32}$/i.test(account ?? "") || !/^[a-f0-9-]{36}$/i.test(database ?? ""))
    throw Error("Configure a valid Cloudflare account and database ID.");
  if (values["confirm-target"] !== `${account}/${database}` || values["confirm-sha256"] !== sha256 ||
      !values["accept-database-block"] || !values["recovery-file"])
    throw Error("Explicit target, SQL hash, database-block approval and recovery file are required.");
  // Exclusive creation prevents overwriting an earlier recovery record. Flush every
  // checkpoint before progressing. Put this private file outside the repository.
  const fd = openSync(values["recovery-file"], "wx", 0o600);
  const deadline = setTimeout(() => {
    console.error("Migration deadline exceeded. Import may still be running; use the recovery record to inspect status. Do not re-import.");
    process.exit(2);
  }, 300_000);
  try {
    registerHooks({ resolve(s, c, next) {
      try { return next(s, c); } catch (e) {
        if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c);
        throw e;
      }
    } });
    const { cloudflareFetch, usesReplitCloudflare } = await import("../src/lib/cloudflare-fetch.server.ts");
    const connector = usesReplitCloudflare();
    const lovable = !connector && env.LOVABLE_API_KEY;
    if (!connector && !env.CLOUDFLARE_API_KEY) throw Error("Cloudflare access is not configured.");
    const root = lovable
      ? `${(env.CONNECTOR_GATEWAY_BASE_URL ?? "https://connector-gateway.lovable.dev").replace(/\/$/, "")}/cloudflare/client/v4`
      : "https://api.cloudflare.com/client/v4";
    const headers = { "Content-Type": "application/json" };
    if (!connector) headers.Authorization = `Bearer ${lovable || env.CLOUDFLARE_API_KEY}`;
    if (lovable) headers["X-Connection-Api-Key"] = env.CLOUDFLARE_API_KEY;
    const transport = createTransport({ request: cloudflareFetch, base: `${root}/accounts/${account}/d1/database/${database}`, headers });
    await runImport({ ...transport, saveRecovery: async record => {
      writeSync(fd, JSON.stringify({ target: `${account}/${database}`, ...record }) + "\n");
      fsyncSync(fd);
    } });
  } finally { clearTimeout(deadline); closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Even filesystem and connector initialization errors can contain private paths/URLs.
    console.error("Support migration did not finish successfully. Check approval flags/configuration and the private recovery record. If ingest started, inspect its status before retrying. No tables-only fallback was attempted.");
    process.exitCode = 1;
  });
}
