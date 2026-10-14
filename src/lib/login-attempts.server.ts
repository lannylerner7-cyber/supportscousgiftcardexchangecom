import { queryOne, execute, newId, nowIso } from "./d1.server";

/** Internal password-verification outcome; never expose this as a server function. */
export async function recordLoginAttempt(email: string, succeeded: boolean) {
  email = email.trim().toLowerCase();
  const now = new Date();

  if (succeeded) {
    await execute(
      "INSERT INTO login_attempts (id, email, succeeded, created_at) VALUES (?, ?, 1, ?)",
      [newId(), email, nowIso()],
    );
    return { locked: false as const, until: null, remaining: 3 };
  }

  const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const fails = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM login_attempts
      WHERE email = ? AND succeeded = 0 AND created_at >= ?`,
    [email, windowStart],
  );
  const failures = (fails?.c ?? 0) + 1;
  const lockedUntil =
    failures >= 3 ? new Date(now.getTime() + 30 * 60 * 1000).toISOString() : null;

  await execute(
    `INSERT INTO login_attempts (id, email, succeeded, locked_until, created_at)
     VALUES (?, ?, 0, ?, ?)`,
    [newId(), email, lockedUntil, nowIso()],
  );
  return {
    locked: Boolean(lockedUntil),
    until: lockedUntil,
    remaining: Math.max(0, 3 - failures),
  };
}
