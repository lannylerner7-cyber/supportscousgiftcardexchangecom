/**
 * Withdrawal PIN (4 digits), stored only as a salted hash on D1.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const pinSchema = z.string().regex(/^\d{4}$/);

/** Does this member already have a PIN? */
export const pinStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { queryOne } = await import("./d1.server");
  const userId = await requireUserId();
  const row = await queryOne<{ withdrawal_pin_hash: string | null }>(
    "SELECT withdrawal_pin_hash FROM profiles WHERE id = ?",
    [userId],
  );
  return { hasPin: Boolean(row?.withdrawal_pin_hash) };
});

/** Set the first PIN, or change it using the current one. */
export const setWithdrawalPin = createServerFn({ method: "POST" })
  .inputValidator((d: { pin: string; currentPin?: string }) =>
    z.object({ pin: pinSchema, currentPin: pinSchema.optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId, hashPassword, verifyPassword } = await import("./guard.server");
    const { queryOne, execute, nowIso } = await import("./d1.server");

    const userId = await requireUserId();
    const row = await queryOne<{ withdrawal_pin_hash: string | null }>(
      "SELECT withdrawal_pin_hash FROM profiles WHERE id = ?",
      [userId],
    );
    if (row?.withdrawal_pin_hash) {
      if (!data.currentPin) return { ok: false as const, error: "pin_required" };
      if (!(await verifyPassword(data.currentPin, row.withdrawal_pin_hash))) {
        return { ok: false as const, error: "wrong_pin" };
      }
    }
    await execute("UPDATE profiles SET withdrawal_pin_hash = ?, updated_at = ? WHERE id = ?", [
      await hashPassword(data.pin),
      nowIso(),
      userId,
    ]);
    return { ok: true as const };
  });

/** Check a PIN before a withdrawal. Used by the withdrawal flow only. */
export async function pinMatches(userId: string, pin: string): Promise<boolean> {
  const { verifyPassword } = await import("./guard.server");
  const { queryOne } = await import("./d1.server");
  const row = await queryOne<{ withdrawal_pin_hash: string | null }>(
    "SELECT withdrawal_pin_hash FROM profiles WHERE id = ?",
    [userId],
  );
  if (!row?.withdrawal_pin_hash) return false;
  return verifyPassword(pin, row.withdrawal_pin_hash);
}

/**
 * Reset a forgotten PIN. The member proves ownership with a code emailed to
 * their own address (purpose "pin"), then a new PIN is written.
 */
export const resetWithdrawalPin = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string; pin: string }) =>
    z.object({ code: z.string().regex(/^\d{6}$/), pin: pinSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId, hashPassword, sha256Hex, timingSafeEqual } = await import(
      "./guard.server"
    );
    const { queryOne, execute, nowIso } = await import("./d1.server");

    const userId = await requireUserId();
    const profile = await queryOne<{ email: string }>("SELECT email FROM profiles WHERE id = ?", [
      userId,
    ]);
    const email = (profile?.email ?? "").toLowerCase();
    if (!email) return { ok: false as const, error: "no_code" };

    const row = await queryOne<{ id: string; code_hash: string; expires_at: string }>(
      `SELECT id, code_hash, expires_at FROM otp_codes
        WHERE email = ? AND purpose = 'pin' AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    if (!row) return { ok: false as const, error: "no_code" };
    if (new Date(row.expires_at) < new Date()) return { ok: false as const, error: "expired" };
    if (!timingSafeEqual(await sha256Hex(`${email}:${data.code}`), row.code_hash)) {
      return { ok: false as const, error: "wrong" };
    }

    await execute("UPDATE otp_codes SET consumed_at = ? WHERE id = ?", [nowIso(), row.id]);
    await execute("UPDATE profiles SET withdrawal_pin_hash = ?, updated_at = ? WHERE id = ?", [
      await hashPassword(data.pin),
      nowIso(),
      userId,
    ]);
    return { ok: true as const };
  });
