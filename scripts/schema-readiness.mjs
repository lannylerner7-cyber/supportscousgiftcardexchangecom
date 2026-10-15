import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// Explicit feature boundary; unrelated catalogue, money and push schemas are not gates.
export const requiredTables = [
  "users", "profiles", "sessions", "session_security", "trusted_devices",
  "trusted_device_handles", "user_roles", "otp_codes", "login_attempts",
  "chat_threads", "chat_messages", "support_members", "support_state",
  "support_presence", "support_order", "support_attachments", "support_mail",
  "support_limits", "app_settings", "smtp_settings",
];
export const catalogSql = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger')";
requiredTables.push("passkey_credentials", "passkey_challenges", "passkey_sessions", "passkey_limits");
const quote = name => `"${name.replaceAll('"', '""')}"`;
const normalize = sql => (sql ?? "").replace(/\bIF NOT EXISTS\s+/gi, "")
  .replace(/\s+/g, " ").trim().replace(/;$/, "");
const signature = (rows, fields) => JSON.stringify(rows.map(row => fields.map(k => row[k] ?? null)));

function guidance(table) {
  if (table.startsWith("passkey_")) return "src/db/passkeys.sql (apply before enabling PASSKEY_ENABLED)";
  if (["session_security", "trusted_devices"].includes(table)) return "src/db/remember-devices.sql";
  if (table.startsWith("support_")) return "src/db/schema.sql SUPPORT_CHAT_START..SUPPORT_CHAT_END (see SUPPORT-CHAT.md)";
  if (table === "trusted_device_handles") return "src/db/schema.sql trusted_device_handles (not included in remember-devices.sql)";
  return "src/db/schema.sql (review an explicit additive upgrade; CREATE IF NOT EXISTS does not repair existing tables)";
}

// Only repository DDL is executed, and only in a throwaway local database.
// No seed INSERTs, support backfills, or external database writes.
export function expectedSchema() {
  const source = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  const db = new DatabaseSync(":memory:");
  try {
    const definitions = [...source.matchAll(/^CREATE TRIGGER[\s\S]*?^END;|^CREATE (?:TABLE|(?:UNIQUE )?INDEX)[\s\S]*?;/gm)];
    for (const [sql] of definitions) db.exec(sql);
    const catalog = db.prepare(catalogSql).all().filter(row => requiredTables.includes(row.tbl_name));
    const tables = requiredTables.map(name => ({
      name,
      columns: db.prepare(`PRAGMA table_info(${quote(name)})`).all(),
      foreignKeys: db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all(),
      indexes: db.prepare(`PRAGMA index_list(${quote(name)})`).all().map(index => ({
        ...index, columns: db.prepare(`PRAGMA index_info(${quote(index.name)})`).all(),
      })),
    }));
    if (tables.some(table => !table.columns.length)) throw Error("Incomplete manifest");
    return { catalog, tables };
  } finally { db.close(); }
}

export async function checkSchemaReadiness(query, expected = expectedSchema()) {
  const issues = [];
  const add = (kind, object, table) => issues.push({ kind, object, migration: guidance(table) });
  try {
    const catalog = await query(catalogSql);
    for (const table of expected.tables) {
      if (!catalog.some(row => row.type === "table" && row.name === table.name)) {
        add("missing_table", table.name, table.name);
        continue;
      }
      const columns = await query(`PRAGMA table_info(${quote(table.name)})`);
      for (const column of table.columns) {
        const actual = columns.find(row => row.name === column.name);
        if (!actual) add("missing_column", `${table.name}.${column.name}`, table.name);
        else if (signature([actual], ["type", "notnull", "dflt_value", "pk"]) !==
          signature([column], ["type", "notnull", "dflt_value", "pk"]))
          add("column_definition_mismatch", `${table.name}.${column.name}`, table.name);
      }
      const keys = await query(`PRAGMA foreign_key_list(${quote(table.name)})`);
      const keyFields = ["table", "from", "to", "on_update", "on_delete", "match"];
      if (table.foreignKeys.some(key => !keys.some(actual =>
        signature([key], keyFields) === signature([actual], keyFields))))
        add("foreign_key_mismatch", table.name, table.name);
      const indexes = await query(`PRAGMA index_list(${quote(table.name)})`);
      for (const index of table.indexes) {
        // Implicit PK/UNIQUE index names can change when extra constraints are added.
        if (index.origin === "c") continue;
        let found = false;
        for (const actual of indexes.filter(row => row.unique === index.unique && row.partial === 0)) {
          const info = await query(`PRAGMA index_info(${quote(actual.name)})`);
          if (signature(info, ["name"]) === signature(index.columns, ["name"])) found = true;
        }
        if (!found) add("missing_unique_constraint", `${table.name}(${index.columns.map(c => c.name).join(",")})`, table.name);
      }
    }
    for (const object of expected.catalog.filter(row => row.type !== "table" && row.sql)) {
      const actual = catalog.find(row => row.type === object.type && row.name === object.name);
      if (!actual) add(`missing_${object.type}`, object.name, object.tbl_name.startsWith("chat_") && object.type === "trigger" ? "support_triggers" : object.tbl_name);
      else if (actual.tbl_name !== object.tbl_name || normalize(actual.sql) !== normalize(object.sql))
        add(`${object.type}_definition_mismatch`, object.name, object.tbl_name.startsWith("chat_") && object.type === "trigger" ? "support_triggers" : object.tbl_name);
    }
    return { status: issues.length ? "not_ready" : "ready", issues };
  } catch {
    // Never echo provider responses, SQL, connection details, or arbitrary error text.
    return { status: "check_failed", issues, diagnostic: "Schema metadata could not be read. Check database access/configuration and retry; do not release." };
  }
}
