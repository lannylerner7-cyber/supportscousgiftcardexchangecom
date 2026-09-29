/**
 * Email codes (OTP), sign-in lock-out and password reset — all on D1.
 *
 * A code is never stored in readable form: only a SHA-256 hash of
 * `email:code`. Codes live 5 minutes, allow 3 tries, can be re-sent once a
 * minute and at most 5 times an hour.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_S,
  OTP_TTL_MIN as TTL_MIN,
  sixDigitCode,
} from "./otp-policy";

const purposeSchema = z.enum(["signup", "login", "reset", "pin"]);
export type OtpPurpose = z.infer<typeof purposeSchema>;

const sixDigits = sixDigitCode;

export const OTP_TTL_MIN = TTL_MIN;
const RESEND_COOLDOWN_S = OTP_RESEND_COOLDOWN_S;
const MAX_RESENDS_PER_HOUR = OTP_MAX_RESENDS_PER_HOUR;
const MAX_ATTEMPTS = OTP_MAX_ATTEMPTS;

/** Issue a fresh code, invalidating any previous unused one. */
export const requestOtp = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; purpose: OtpPurpose }) =>
    z.object({ email: z.string().email(), purpose: purposeSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const { transaction, execute, newId, nowIso } = await import("./d1.server");
    const { sha256Hex } = await import("./guard.server");
    const { sendEmail, otpEmail, emailConfigured } = await import("./email.server");

    const email = data.email.trim().toLowerCase();
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    // One read: is this an admin account (role read from user_roles) and
    // which codes were sent recently.
    const [adminRows, recentRows] = await transaction([
      {
        sql: `SELECT 1 AS yes FROM user_roles r JOIN users u ON u.id = r.user_id
               WHERE u.email = ? AND r.role = 'admin' LIMIT 1`,
        params: [email],
      },
      {
        sql: `SELECT created_at FROM otp_codes
               WHERE email = ? AND purpose = ? AND created_at >= ?
               ORDER BY created_at DESC`,
        params: [email, data.purpose, hourAgo],
      },
    ]);

    // Admin accounts never get a login code: the daily mail allowance is
    // reserved for members, and the password already opened their session.
    const adminEmail = (process.env["ADMIN_EMAIL"] ?? "").trim().toLowerCase();
    const isAdmin = (adminRows ?? []).length > 0 || (Boolean(adminEmail) && adminEmail === email);
    if (isAdmin && data.purpose !== "reset") {
      return {
        ok: true as const,
        adminBypass: true as const,
        delivered: false,
        emailConfigured: emailConfigured(),
        expiresAt: null,
        ttlMinutes: OTP_TTL_MIN,
      };
    }

    const rows = (recentRows ?? []) as { created_at: string }[];

    if (rows.length > 0) {
      const elapsed = (now.getTime() - new Date(rows[0]!.created_at).getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_S) {
        return {
          ok: false as const,
          error: "cooldown",
          retryIn: Math.ceil(RESEND_COOLDOWN_S - elapsed),
        };
      }
    }
    if (rows.length >= MAX_RESENDS_PER_HOUR) {
      return { ok: false as const, error: "too_many", retryIn: 3600 };
    }

    await execute(
      `UPDATE otp_codes SET consumed_at = ?
        WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
      [nowIso(), email, data.purpose],
    );

    const code = sixDigits();
    const expires = new Date(now.getTime() + OTP_TTL_MIN * 60 * 1000);
    await execute(
      `INSERT INTO otp_codes (id, email, purpose, code_hash, expires_at, resend_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        email,
        data.purpose,
        await sha256Hex(`${email}:${code}`),
        expires.toISOString(),
        rows.length,
        nowIso(),
      ],
    );

    const mail = otpEmail(code, data.purpose, OTP_TTL_MIN);
    const result = await sendEmail({
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    return {
      ok: true as const,
      adminBypass: false as const,
      delivered: result.sent,
      emailConfigured: emailConfigured(),
      expiresAt: expires.toISOString(),
      ttlMinutes: OTP_TTL_MIN,
    };
  });

/** Check a code and, when valid, mark the account verified. */
export const verifyOtpCode = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; purpose: OtpPurpose; code: string }) =>
    z
      .object({
        email: z.string().email(),
        purpose: purposeSchema,
        code: z.string().regex(/^\d{6}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { queryOne, execute, nowIso } = await import("./d1.server");
    const { sha256Hex, timingSafeEqual, startSession } = await import("./guard.server");
    const email = data.email.trim().toLowerCase();

    const row = await queryOne<{
      id: string;
      code_hash: string;
      expires_at: string;
      attempts: number;
    }>(
      `SELECT id, code_hash, expires_at, attempts FROM otp_codes
        WHERE email = ? AND purpose = ? AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [email, data.purpose],
    );

    if (!row) return { ok: false as const, error: "no_code" };
    if (new Date(row.expires_at) < new Date()) return { ok: false as const, error: "expired" };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false as const, error: "attempts" };

    const hash = await sha256Hex(`${email}:${data.code}`);
    if (!timingSafeEqual(hash, row.code_hash)) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Burn the code after three wrong tries so a new one has to be sent.
        await execute("UPDATE otp_codes SET attempts = ?, consumed_at = ? WHERE id = ?", [
          attempts,
          nowIso(),
          row.id,
        ]);
        return { ok: false as const, error: "attempts" };
      }
      await execute("UPDATE otp_codes SET attempts = ? WHERE id = ?", [attempts, row.id]);
      return { ok: false as const, error: "wrong", remaining: MAX_ATTEMPTS - attempts };
    }

    await execute("UPDATE otp_codes SET consumed_at = ? WHERE id = ?", [nowIso(), row.id]);

    if (data.purpose === "signup") {
      await execute("UPDATE profiles SET is_verified = 1, updated_at = ? WHERE email = ?", [
        nowIso(),
        email,
      ]);
      // The welcome email is deliberately not awaited: signup and verification
      // never wait on the mail server, and a mail failure can't fail the code.
      void (async () => {
        try {
          const { sendEmail, welcomeEmail, emailConfigured } = await import("./email.server");
          if (!emailConfigured()) return;
          const who = await queryOne<{ full_name: string }>(
            "SELECT full_name FROM profiles WHERE email = ? LIMIT 1",
            [email],
          );
          const mail = welcomeEmail(who?.full_name ?? "");
          await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
        } catch (e) {
          console.error("[email] welcome send failed", (e as Error).message);
        }
      })();
    }

    // A correct login code re-confirms the session that the password opened.
    if (data.purpose === "login" || data.purpose === "signup") {
      const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]);
      if (user) await startSession(user.id, email);
    }
    return { ok: true as const };
  });

/** Is this email known, and is it currently locked out? */
export const loginGate = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data }) => {
    const { queryOne } = await import("./d1.server");
    const email = data.email.trim().toLowerCase();

    const profile = await queryOne<{ id: string; deleted_at: string | null }>(
      "SELECT id, deleted_at FROM profiles WHERE email = ? LIMIT 1",
      [email],
    );
    if (!profile || profile.deleted_at) return { ok: false as const, error: "unknown_user" };

    const locked = await queryOne<{ locked_until: string }>(
      `SELECT locked_until FROM login_attempts
        WHERE email = ? AND locked_until IS NOT NULL AND locked_until > ?
        ORDER BY created_at DESC LIMIT 1`,
      [email, new Date().toISOString()],
    );
    if (locked?.locked_until) {
      return { ok: false as const, error: "locked", until: locked.locked_until };
    }
    return { ok: true as const };
  });

/** Record a login outcome; three failures in 15 minutes locks for 30. */
export const recordLoginAttempt = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; succeeded: boolean }) =>
    z.object({ email: z.string().email(), succeeded: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { queryOne, execute, newId, nowIso } = await import("./d1.server");
    const email = data.email.trim().toLowerCase();
    const now = new Date();

    if (data.succeeded) {
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
  });

/** Finish signup: welcome email + verification fallback when mail is unavailable. */
export const completeSignup = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; fullName: string }) =>
    z.object({ email: z.string().email(), fullName: z.string().max(120) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { execute, nowIso } = await import("./d1.server");
    const { sendEmail, welcomeEmail, emailConfigured } = await import("./email.server");
    const email = data.email.trim().toLowerCase();

    if (!emailConfigured()) {
      // No mail account connected yet: don't lock people out of their own account.
      await execute("UPDATE profiles SET is_verified = 1, updated_at = ? WHERE email = ?", [
        nowIso(),
        email,
      ]);
      return { verifiedWithoutEmail: true as const };
    }

    const mail = welcomeEmail(data.fullName);
    await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
    return { verifiedWithoutEmail: false as const };
  });

/**
 * Finish a password reset with the emailed code. Verifying the code and
 * writing the new password happen together so a used code cannot be replayed.
 */
export const resetPasswordWithCode = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; code: string; password: string }) =>
    z
      .object({
        email: z.string().email(),
        code: z.string().regex(/^\d{6}$/),
        password: z.string().min(8).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { queryOne, execute, nowIso } = await import("./d1.server");
    const { sha256Hex, timingSafeEqual, hashPassword, startSession } = await import(
      "./guard.server"
    );
    const email = data.email.trim().toLowerCase();

    const row = await queryOne<{
      id: string;
      code_hash: string;
      expires_at: string;
      attempts: number;
    }>(
      `SELECT id, code_hash, expires_at, attempts FROM otp_codes
        WHERE email = ? AND purpose = 'reset' AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    if (!row) return { ok: false as const, error: "no_code" };
    if (new Date(row.expires_at) < new Date()) return { ok: false as const, error: "expired" };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false as const, error: "attempts" };

    if (!timingSafeEqual(await sha256Hex(`${email}:${data.code}`), row.code_hash)) {
      const attempts = row.attempts + 1;
      await execute(
        `UPDATE otp_codes SET attempts = ?, consumed_at = ? WHERE id = ?`,
        [attempts, attempts >= MAX_ATTEMPTS ? nowIso() : null, row.id],
      );
      return attempts >= MAX_ATTEMPTS
        ? { ok: false as const, error: "attempts" }
        : { ok: false as const, error: "wrong", remaining: MAX_ATTEMPTS - attempts };
    }

    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]);
    if (!user) return { ok: false as const, error: "no_code" };

    await execute("UPDATE otp_codes SET consumed_at = ? WHERE id = ?", [nowIso(), row.id]);
    await execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [
      await hashPassword(data.password),
      nowIso(),
      user.id,
    ]);
    // A reset clears any active lock-out so the member can get straight in.
    await execute("UPDATE login_attempts SET locked_until = NULL WHERE email = ?", [email]);
    await startSession(user.id, email);
    return { ok: true as const };
  });
