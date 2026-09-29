/**
 * Signup in one round trip.
 *
 * The browser makes a single call: `registerAccount` validates the form,
 * checks the email and the code rate limit in one database read, then writes
 * the account, profile, wallet, roles and the hashed verification code in one
 * all-or-nothing transaction. Only the verification-code email is sent while
 * the person waits; the welcome email goes out after they confirm the code.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  OTP_MAX_RESENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_S,
  OTP_TTL_MIN,
  sixDigitCode,
} from "./otp-policy";

export type RegisterResult =
  | { ok: false; error: "exists" | "cooldown" | "too_many"; retryIn?: number }
  | {
      ok: true;
      userId: string;
      verifiedWithoutEmail: boolean;
      delivered: boolean;
      emailConfigured: boolean;
      expiresAt: string | null;
      ttlMinutes: number;
    };

export const registerAccount = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      email: string;
      password: string;
      fullName: string;
      phone: string;
      referralCode?: string;
    }) =>
      z
        .object({
          email: z.string().email().max(200),
          password: z.string().min(8).max(200),
          fullName: z.string().trim().min(2).max(120),
          phone: z.string().trim().max(30),
          referralCode: z.string().trim().max(40).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }): Promise<RegisterResult> => {
    const { transaction, newId, nowIso } = await import("./d1.server");
    const { hashPassword, sha256Hex, startSession } = await import("./guard.server");
    const { sendEmail, otpEmail, emailConfigured } = await import("./email.server");

    const email = data.email.trim().toLowerCase();
    const referralCode = data.referralCode?.toUpperCase() ?? null;
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    /* ---- one read: taken email + referrer + recent signup codes ---------- */
    const reads = await transaction([
      { sql: "SELECT id FROM users WHERE email = ? LIMIT 1", params: [email] },
      {
        sql: "SELECT id FROM profiles WHERE referral_code = ? LIMIT 1",
        // Sentinel that no real code can match, so this read is always safe.
        params: [referralCode ?? "__no_referral__"],
      },
      {
        sql: `SELECT created_at FROM otp_codes
                WHERE email = ? AND purpose = 'signup' AND created_at >= ?
                ORDER BY created_at DESC`,
        params: [email, hourAgo],
      },
    ]);

    if ((reads[0] ?? []).length > 0) return { ok: false, error: "exists" };

    const referrerId = referralCode
      ? ((reads[1]?.[0]?.["id"] as string | undefined) ?? null)
      : null;

    const recent = (reads[2] ?? []) as { created_at: string }[];
    if (recent.length > 0) {
      const elapsed = (now.getTime() - new Date(recent[0]!.created_at).getTime()) / 1000;
      if (elapsed < OTP_RESEND_COOLDOWN_S) {
        return { ok: false, error: "cooldown", retryIn: Math.ceil(OTP_RESEND_COOLDOWN_S - elapsed) };
      }
    }
    if (recent.length >= OTP_MAX_RESENDS_PER_HOUR) {
      return { ok: false, error: "too_many", retryIn: 3600 };
    }

    /* ---- one write: account + profile + wallet + roles + code ------------ */
    const userId = newId();
    const iso = nowIso();
    const ownReferral = `SC${userId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const adminEmail = (process.env["ADMIN_EMAIL"] ?? "").trim().toLowerCase();
    const isAdmin = Boolean(adminEmail) && adminEmail === email;

    // Admin accounts never receive a verification code: they are verified
    // instantly so the daily mail allowance is reserved for members.
    const mailReady = emailConfigured() && !isAdmin;

    const code = mailReady ? sixDigitCode() : null;
    const expires = mailReady ? new Date(now.getTime() + OTP_TTL_MIN * 60 * 1000) : null;

    const statements: { sql: string; params?: unknown[] }[] = [
      {
        sql: `INSERT INTO users (id, email, password_hash, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)`,
        params: [userId, email, await hashPassword(data.password), iso, iso],
      },
      {
        // No mail account connected yet: verify straight away so nobody is
        // locked out of the account they just created.
        sql: `INSERT INTO profiles (id, full_name, email, phone, referral_code, referred_by, is_verified, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          userId,
          data.fullName.trim(),
          email,
          data.phone.trim() || null,
          ownReferral,
          referrerId,
          mailReady ? 0 : 1,
          iso,
          iso,
        ],
      },
      {
        sql: `INSERT INTO wallets (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        params: [newId(), userId, iso, iso],
      },
      {
        sql: `INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
        params: [newId(), userId, "user", iso],
      },
    ];

    // The one account named in ADMIN_EMAIL also gets the admin role.
    if (isAdmin) {
      statements.push({
        sql: `INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
        params: [newId(), userId, "admin", iso],
      });
    }

    if (code && expires) {
      statements.push({
        sql: `UPDATE otp_codes SET consumed_at = ?
                WHERE email = ? AND purpose = 'signup' AND consumed_at IS NULL`,
        params: [iso, email],
      });
      statements.push({
        sql: `INSERT INTO otp_codes (id, email, purpose, code_hash, expires_at, resend_count, created_at)
              VALUES (?, ?, 'signup', ?, ?, ?, ?)`,
        params: [
          newId(),
          email,
          await sha256Hex(`${email}:${code}`),
          expires.toISOString(),
          recent.length,
          iso,
        ],
      });
    }

    await transaction(statements);
    await startSession(userId, email);

    if (!code || !expires) {
      return {
        ok: true,
        userId,
        verifiedWithoutEmail: true,
        delivered: false,
        emailConfigured: false,
        expiresAt: null,
        ttlMinutes: OTP_TTL_MIN,
      };
    }

    const mail = otpEmail(code, "signup", OTP_TTL_MIN);
    const sent = await sendEmail({
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    return {
      ok: true,
      userId,
      verifiedWithoutEmail: false,
      delivered: sent.sent,
      emailConfigured: true,
      expiresAt: expires.toISOString(),
      ttlMinutes: OTP_TTL_MIN,
    };
  });
