import { registerHooks } from "node:module";
import { checkSchemaReadiness, requiredTables } from "./schema-readiness.mjs";

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
  console.log("Read-only login/support release gate. Node 24+, source checkout and installed dependencies required.");
  console.log("Run with --check only after verifying the configured target. Uses the existing D1 transport; no migrations or member-row reads.");
  console.log(`Required tables: ${requiredTables.join(", ")}`);
} else if (args.length !== 1 || args[0] !== "--check") {
  console.error("Usage: node scripts/check-schema-readiness.mjs [--check|--help]");
  process.exitCode = 2;
} else {
  registerHooks({ resolve(s, c, next) {
    try { return next(s, c); } catch (error) {
      if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c);
      throw error;
    }
  } });
  // Hard deadline also covers connector initialization, which can precede fetch.
  const deadline = setTimeout(() => {
    console.error(JSON.stringify({ status: "check_failed", diagnostic: "Schema check timed out; do not release." }));
    process.exit(2);
  }, 120_000);
  try {
    const { query } = await import("../src/lib/d1.server.ts");
    const result = await checkSchemaReadiness((sql) => query(sql, [], AbortSignal.timeout(15_000)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "ready" ? 0 : result.status === "not_ready" ? 1 : 2;
  } catch {
    console.error(JSON.stringify({ status: "check_failed", diagnostic: "Unable to initialize schema check. Verify Node 24, dependencies and database configuration; do not release." }));
    process.exitCode = 2;
  } finally { clearTimeout(deadline); }
}
