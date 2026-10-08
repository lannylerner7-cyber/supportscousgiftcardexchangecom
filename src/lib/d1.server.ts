/**
 * Cloudflare D1 access (server-only).
 *
 * Every query goes to the project's own D1 database through Cloudflare's
 * database API, proxied by the Lovable connector gateway so the Cloudflare
 * token is never handled here. Works identically in preview, on the published
 * site and inside the Docker container.
 *
 * Money rule: all money columns are INTEGER kobo. Convert at this boundary
 * with `toNaira` / `toKobo` so the rest of the app keeps working in naira.
 */

import { cloudflareFetch, usesReplitCloudflare } from "./cloudflare-fetch.server";
import { publicCache } from "./public-cache.server";
import { measure } from "./observability.server";

export type Row = Record<string, unknown>;

export type Statement = { sql: string; params?: unknown[] };

function gatewayBase() {
  if (usesReplitCloudflare()) return "https://api.cloudflare.com/client/v4";
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (lovableKey) {
    const base = process.env["CONNECTOR_GATEWAY_BASE_URL"] ?? "https://connector-gateway.lovable.dev";
    return `${base.replace(/\/$/, "")}/cloudflare/client/v4`;
  }
  return "https://api.cloudflare.com/client/v4";
}

function credentials() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const cfKey = process.env["CLOUDFLARE_API_KEY"];
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const databaseId = process.env["D1_DATABASE_ID"];
  if ((!cfKey && !usesReplitCloudflare()) || !accountId || !databaseId) {
    throw new Error(
      "Database is not configured: CLOUDFLARE_API_KEY, CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID are required.",
    );
  }
  return { lovableKey, cfKey, accountId, databaseId };
}

type D1Result = {
  results?: Row[];
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number; rows_written?: number };
};

async function post(sql: string, params: unknown[], batch?: Statement[]): Promise<D1Result[]> {
  const started = performance.now();
  let ok = false;
  try {
  const { lovableKey, cfKey, accountId, databaseId } = credentials();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (lovableKey) {
    headers["Authorization"] = `Bearer ${lovableKey}`;
    headers["X-Connection-Api-Key"] = cfKey ?? "";
  } else {
    headers["Authorization"] = `Bearer ${cfKey}`;
  }

  const response = await cloudflareFetch(
    `${gatewayBase()}/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers,
      body: JSON.stringify(batch
        ? { batch: batch.map(s => ({ sql: s.sql, params: (s.params ?? []).map(bind) })) }
        : { sql, params: params.map(bind) }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    console.error(`D1 request failed [${response.status}]`);
    throw new Error(`Database request failed [${response.status}]. Please try again or contact support.`);
  }

  const payload = JSON.parse(text) as {
    success?: boolean;
    errors?: { message?: string }[];
    result?: D1Result[];
  };
  if (!payload.success) {
    throw new Error("Database request failed. Please try again or contact support.");
  }
  if (payload.result?.some(r => r.success === false)) throw new Error("Database statement failed.");
  ok = true;
  return payload.result ?? [];
  } finally { measure("d1", performance.now() - started, ok); }
}

/** D1 only accepts primitives over the wire. */
function bind(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Run one statement and return its rows. */
export async function query<T extends Row = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await post(sql, params);
    return (result[result.length - 1]?.results ?? []) as T[];
  } finally {
    if (!/^\s*SELECT\b/i.test(sql)) publicCache.clear();
  }
}

/** Run one statement and return the first row, or null. */
export async function queryOne<T extends Row = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Run one write statement. */
export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ changes: number }> {
  try {
    const result = await post(sql, params);
    return { changes: result[result.length - 1]?.meta?.changes ?? 0 };
  } finally { publicCache.clear(); }
}

/**
 * D1's native batch request preserves per-statement parameter binding and
 * all-or-nothing execution. Do not interpolate user values into SQL.
 */
export async function transaction(statements: Statement[]): Promise<Row[][]> {
  if (!statements.length) return [];
  try {
    const result = await post("", [], statements);
    return result.map((r) => r.results ?? []);
  } finally { publicCache.clear(); }
}

/** Opt-in, bounded cache for catalogue SELECTs only. */
export function publicQuery<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return publicCache.read(JSON.stringify([sql, params]), () => query<T>(sql, params));
}

/** Quote a value as a SQLite literal. Never accepts raw SQL. */
export function literal(value: unknown): string {
  if (value === undefined || value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Refusing to store a non-finite number");
    return String(value);
  }
  if (value instanceof Date) return `'${value.toISOString()}'`;
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // SQLite ends a string at a NUL byte, which would break the statement.
  return `'${text.replace(/\u0000/g, "").replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ money */

/** Kobo (stored) -> naira (shown). */
export function toNaira(kobo: unknown): number {
  const n = Number(kobo ?? 0);
  return Number.isFinite(n) ? Math.round(n) / 100 : 0;
}

/** Naira (entered) -> kobo (stored). */
export function toKobo(naira: unknown): number {
  const n = Number(naira ?? 0);
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

/* ------------------------------------------------------------------ helpers */

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}
