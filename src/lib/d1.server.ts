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

export type Row = Record<string, unknown>;

export type Statement = { sql: string; params?: unknown[] };

function gatewayBase() {
  const base = process.env["CONNECTOR_GATEWAY_BASE_URL"] ?? "https://connector-gateway.lovable.dev";
  return `${base.replace(/\/$/, "")}/cloudflare/client/v4`;
}

function credentials() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const cfKey = process.env["CLOUDFLARE_API_KEY"];
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const databaseId = process.env["D1_DATABASE_ID"];
  if (!lovableKey || !cfKey || !accountId || !databaseId) {
    throw new Error(
      "Database is not configured: LOVABLE_API_KEY, CLOUDFLARE_API_KEY, CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID are all required.",
    );
  }
  return { lovableKey, cfKey, accountId, databaseId };
}

type D1Result = {
  results?: Row[];
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number; rows_written?: number };
};

async function post(sql: string, params: unknown[]): Promise<D1Result[]> {
  const { lovableKey, cfKey, accountId, databaseId } = credentials();
  const response = await fetch(
    `${gatewayBase()}/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": cfKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params: params.map(bind) }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    console.error(`D1 request failed [${response.status}]: ${text}`);
    throw new Error(`Database request failed [${response.status}]: ${text}`);
  }

  const payload = JSON.parse(text) as {
    success?: boolean;
    errors?: { message?: string }[];
    result?: D1Result[];
  };
  if (!payload.success) {
    const message = payload.errors?.map((e) => e.message).join("; ") ?? text;
    console.error(`D1 error: ${message}`);
    throw new Error(`Database error: ${message}`);
  }
  return payload.result ?? [];
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
  const result = await post(sql, params);
  return (result[result.length - 1]?.results ?? []) as T[];
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
  const result = await post(sql, params);
  return { changes: result[result.length - 1]?.meta?.changes ?? 0 };
}

/**
 * Run several statements as one all-or-nothing batch. D1 wraps a multi-statement
 * request in a single transaction, so either every statement lands or none do.
 * Values are inlined through `literal`, which is the only safe way to carry
 * per-statement values in a batched request.
 */
export async function transaction(statements: Statement[]): Promise<Row[][]> {
  const sql = statements
    .map((s) => inline(s.sql, s.params ?? []))
    .map((s) => (s.trim().endsWith(";") ? s.trim() : `${s.trim()};`))
    .join("\n");
  const result = await post(sql, []);
  return result.map((r) => r.results ?? []);
}

/** Replace ? placeholders with safely quoted literals. */
function inline(sql: string, params: unknown[]): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    if (index >= params.length) throw new Error("Not enough parameters for statement");
    return literal(params[index++]);
  });
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
