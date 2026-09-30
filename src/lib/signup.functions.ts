/**
 * Signup in one round trip.
 *
 * The browser makes a single call: `registerAccount` validates the form, then
 * sends ONE database transaction that checks the email and the code rate
 * limit and — only if they pass — writes the account, profile, wallet, roles
 * and the hashed verification code. Only the verification-code email is sent
 * while the person waits; the welcome email goes out after they confirm it.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  OTP_MAX_RESENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_S,
  OTP_TTL_MIN,
  sixDigitCode,
} from "./otp-policy";
import { REFERRAL_BONUS_KOBO } from "./referral";

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
    const cooldownFrom = new Date(now.getTime() - OTP_RESEND_COOLDOWN_S * 1000).toISOString();

    const userId = newId();
    const walletId = newId();
    const iso = nowIso();
    const ownReferral = `SC${userId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const adminEmail = (process.env["ADMIN_EMAIL"] ?? "").trim().toLowerCase();
    const isAdmin = Boolean(adminEmail) && adminEmail === email;

    // Admin accounts never receive a verification code: they are verified
    // instantly so the daily mail allowance is reserved for members.
    const mailReady = emailConfigured() && !isAdmin;
    const code = mailReady ? sixDigitCode() : null;
    const expires = mailReady ? new Date(now.getTime() + OTP_TTL_MIN * 60 * 1000) : null;

    const [passwordHash, codeHash] = await Promise.all([
      hashPassword(data.password),
      code ? sha256Hex(`${email}:${code}`) : Promise.resolve(null),
    ]);

    /*
     * ONE database request. The first statement reads the rate/duplicate
     * state; the account insert is guarded by the same conditions, and every
     * later write only lands if that account row now exists. D1 runs the batch
     * as a single all-or-nothing transaction.
     */
    const guard = `NOT EXISTS (SELECT 1 FROM users WHERE email = ?)
      AND NOT EXISTS (SELECT 1 FROM otp_codes WHERE email = ? AND purpose = 'signup' AND created_at >= ?)
      AND (SELECT COUNT(*) FROM otp_codes WHERE email = ? AND purpose = 'signup' AND created_at >= ?) < ?`;
    const guardParams = [email, email, cooldownFrom, email, hourAgo, OTP_MAX_RESENDS_PER_HOUR];
    const created = "EXISTS (SELECT 1 FROM users WHERE id = ?)";

    const statements: { sql: string; params?: unknown[] }[] = [
      {
        sql: `SELECT
                (SELECT COUNT(*) FROM users WHERE email = ?) AS taken,
                (SELECT MAX(created_at) FROM otp_codes WHERE email = ? AND purpose = 'signup' AND created_at >= ?) AS last_at,
                (SELECT COUNT(*) FROM otp_codes WHERE email = ? AND purpose = 'signup' AND created_at >= ?) AS recent`,
        params: [email, email, hourAgo, email, hourAgo],
      },
      {
        sql: `INSERT INTO users (id, email, password_hash, created_at, updated_at)
              SELECT ?, ?, ?, ?, ? WHERE ${guard}`,
        params: [userId, email, passwordHash, iso, iso, ...guardParams],
      },
      {
        // No mail account connected yet (or admin): verify straight away so
        // nobody is locked out of the account they just created.
        sql: `INSERT INTO profiles (id, full_name, email, phone, referral_code, referred_by, is_verified, created_at, updated_at)
              SELECT ?, ?, ?, ?, ?, (SELECT id FROM profiles WHERE referral_code = ? LIMIT 1), ?, ?, ?
              WHERE ${created}`,
        params: [
          userId,
          data.fullName.trim(),
          email,
          data.phone.trim() || null,
          ownReferral,
          referralCode,
          mailReady ? 0 : 1,
          iso,
          iso,
          userId,
        ],
      },
      {
        // Every member gets the ₦5,000 welcome bonus; a valid referral code
        // adds ₦2,000. Both stay locked until the first card is redeemed.
        sql: `INSERT INTO wallets (id, user_id, balance_naira, locked_naira, created_at, updated_at)
              SELECT ?, ?, b.v, b.v, ?, ?
                FROM (SELECT ? + CASE WHEN EXISTS (SELECT 1 FROM profiles WHERE referral_code = ? AND id <> ?)
                                  THEN ? ELSE 0 END AS v) b
               WHERE ${created}`,
        params: [walletId, userId, iso, iso, signupBonus, referralCode ?? "__no_referral__", userId, REFERRAL_BONUS_KOBO, userId],
      },
      {
        sql: `INSERT INTO wallet_transactions (id, wallet_id, user_id, type, amount, balance_after,
                     reference_type, reference_id, note, created_at)
              SELECT ?, ?, ?, 'credit', ?, ?, 'signup_bonus', ?, 'Welcome bonus (unlocks after your first redeemed card)', ?
               WHERE ${created} AND ? > 0`,
        params: [newId(), walletId, userId, signupBonus, signupBonus, userId, iso, userId, signupBonus],
      },
      {
        sql: `INSERT INTO wallet_transactions (id, wallet_id, user_id, type, amount, balance_after,
                     reference_type, reference_id, note, created_at)
              SELECT ?, ?, ?, 'credit', ?, locked_naira, 'referral_signup', ?, 'Referral bonus (unlocks after your first redeemed card)', ?
                FROM wallets WHERE id = ? AND locked_naira > ? AND ${created}`,
        params: [newId(), walletId, userId, REFERRAL_BONUS_KOBO, userId, iso, walletId, signupBonus, userId],
      },
      {
        sql: `INSERT INTO user_roles (id, user_id, role, created_at)
              SELECT ?, ?, 'user', ? WHERE ${created}`,
        params: [newId(), userId, iso, userId],
      },
    ];

    // The one account named in ADMIN_EMAIL also gets the admin role.
    if (isAdmin) {
      statements.push({
        sql: `INSERT INTO user_roles (id, user_id, role, created_at)
              SELECT ?, ?, 'admin', ? WHERE ${created}`,
        params: [newId(), userId, iso, userId],
      });
    }

    if (codeHash && expires) {
      statements.push({
        sql: `UPDATE otp_codes SET consumed_at = ?
                WHERE email = ? AND purpose = 'signup' AND consumed_at IS NULL AND ${created}`,
        params: [iso, email, userId],
      });
      statements.push({
        sql: `INSERT INTO otp_codes (id, email, purpose, code_hash, expires_at, resend_count, created_at)
              SELECT ?, ?, 'signup', ?, ?,
                (SELECT COUNT(*) FROM otp_codes WHERE email = ? AND purpose = 'signup' AND created_at >= ?), ?
              WHERE ${created}`,
        params: [newId(), email, codeHash, expires.toISOString(), email, hourAgo, iso, userId],
      });
    }

    statements.push({ sql: "SELECT id FROM users WHERE id = ?", params: [userId] });

    const results = await transaction(statements);
    const check = (results[0]?.[0] ?? {}) as { taken?: number; last_at?: string | null; recent?: number };
    const wasCreated = (results[results.length - 1] ?? []).length > 0;

    if (!wasCreated) {
      if (Number(check.taken ?? 0) > 0) return { ok: false, error: "exists" };
      if (check.last_at) {
        const elapsed = (now.getTime() - new Date(check.last_at).getTime()) / 1000;
        if (elapsed < OTP_RESEND_COOLDOWN_S) {
          return { ok: false, error: "cooldown", retryIn: Math.ceil(OTP_RESEND_COOLDOWN_S - elapsed) };
        }
      }
      if (Number(check.recent ?? 0) >= OTP_MAX_RESENDS_PER_HOUR) {
        return { ok: false, error: "too_many", retryIn: 3600 };
      }
      throw new Error("Account could not be created");
    }

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

    // Only the code email is awaited, and never for more than 10 seconds —
    // a slow mail server must not leave the person staring at a spinner.
    // They can always ask for a new code from the verify page.
    const mail = otpEmail(code, "signup", OTP_TTL_MIN);
    const sending = sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text })
      .then((r) => r.sent)
      .catch((e: unknown) => {
        console.error("Signup code email failed:", e);
        return false;
      });
    const delivered = await Promise.race([
      sending,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);

    return {
      ok: true,
      userId,
      verifiedWithoutEmail: false,
      delivered,
      emailConfigured: true,
      expiresAt: expires.toISOString(),
      ttlMinutes: OTP_TTL_MIN,
    };
  });
