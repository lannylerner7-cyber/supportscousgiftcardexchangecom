/**
 * Accounts: signup, login, logout, profile and password.
 *
 * All of it runs on the server against the project's own D1 database. The
 * browser never receives a password hash, a PIN hash or another member's row.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_verified: boolean;
  hide_balance_default: boolean;
  sound_enabled: boolean;
  push_enabled: boolean;
  referral_code: string | null;
  admin_code: string | null;
};

export type Account = {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  isAdmin: boolean;
  frozen: boolean;
};

const emailSchema = z.string().email().max(200);

/** Everything the app needs to know about the current visitor, in one call. */
export const getAccount = createServerFn({ method: "GET" }).handler(async (): Promise<Account> => {
  const { currentUserId, isAdmin } = await import("./guard.server");
  const { queryOne } = await import("./d1.server");

  const userId = await currentUserId();
  if (!userId) return { user: null, profile: null, isAdmin: false, frozen: false };

  const row = await queryOne<Record<string, unknown>>(
    `SELECT p.id, p.full_name, p.email, p.phone, p.is_verified, p.hide_balance_default,
            p.sound_enabled, p.push_enabled, p.referral_code, p.admin_code,
            p.frozen_at, p.deleted_at
       FROM profiles p WHERE p.id = ? LIMIT 1`,
    [userId],
  );
  if (!row || row["deleted_at"]) {
    return { user: null, profile: null, isAdmin: false, frozen: false };
  }

  return {
    user: { id: userId, email: String(row["email"]) },
    profile: {
      id: String(row["id"]),
      full_name: String(row["full_name"] ?? ""),
      email: String(row["email"]),
      phone: (row["phone"] as string | null) ?? null,
      is_verified: Boolean(row["is_verified"]),
      hide_balance_default: Boolean(row["hide_balance_default"]),
      sound_enabled: Boolean(row["sound_enabled"]),
      push_enabled: Boolean(row["push_enabled"]),
      referral_code: (row["referral_code"] as string | null) ?? null,
      admin_code: (row["admin_code"] as string | null) ?? null,
    },
    isAdmin: await isAdmin(userId),
    frozen: Boolean(row["frozen_at"]),
  };
});

/** Create the account, its profile, its wallet and its role in one batch. */
export const signUp = createServerFn({ method: "POST" })
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
          email: emailSchema,
          password: z.string().min(8).max(200),
          fullName: z.string().trim().min(2).max(120),
          phone: z.string().trim().max(30),
          referralCode: z.string().trim().max(40).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const { hashPassword, startSession } = await import("./guard.server");
    const { queryOne, transaction, newId, nowIso } = await import("./d1.server");

    const email = data.email.trim().toLowerCase();
    const existing = await queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) return { ok: false as const, error: "exists" };

    const referrer = data.referralCode
      ? await queryOne<{ id: string }>("SELECT id FROM profiles WHERE referral_code = ?", [
          data.referralCode.toUpperCase(),
        ])
      : null;

    const userId = newId();
    const now = nowIso();
    const referralCode = `SC${userId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const adminEmail = (process.env["ADMIN_EMAIL"] ?? "").trim().toLowerCase();

    const statements = [
      {
        sql: `INSERT INTO users (id, email, password_hash, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)`,
        params: [userId, email, await hashPassword(data.password), now, now],
      },
      {
        sql: `INSERT INTO profiles (id, full_name, email, phone, referral_code, referred_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          userId,
          data.fullName.trim(),
          email,
          data.phone.trim() || null,
          referralCode,
          referrer?.id ?? null,
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO wallets (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        params: [newId(), userId, now, now],
      },
      {
        sql: `INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
        params: [newId(), userId, "user", now],
      },
    ];

    // The one account named in ADMIN_EMAIL also gets the admin role.
    if (adminEmail && adminEmail === email) {
      statements.push({
        sql: `INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
        params: [newId(), userId, "admin", now],
      });
    }

    await transaction(statements);
    await startSession(userId, email);
    return { ok: true as const, userId };
  });

/** Check the password and open a session. Lock-out is handled by loginGate. */
export const signIn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string }) =>
    z.object({ email: emailSchema, password: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { verifyPassword, startSession } = await import("./guard.server");
    const { queryOne, execute, nowIso } = await import("./d1.server");

    const email = data.email.trim().toLowerCase();
    const user = await queryOne<{ id: string; password_hash: string }>(
      `SELECT u.id, u.password_hash FROM users u
         JOIN profiles p ON p.id = u.id
        WHERE u.email = ? AND p.deleted_at IS NULL LIMIT 1`,
      [email],
    );
    if (!user) return { ok: false as const, error: "bad_credentials" };
    if (!(await verifyPassword(data.password, user.password_hash))) {
      return { ok: false as const, error: "bad_credentials" };
    }

    await execute("UPDATE users SET last_sign_in_at = ? WHERE id = ?", [nowIso(), user.id]);
    await startSession(user.id, email);
    return { ok: true as const, userId: user.id };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { endSession } = await import("./guard.server");
  await endSession();
  return { ok: true as const };
});

/** Save the member's own profile fields. */
export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      fullName?: string;
      phone?: string;
      hideBalanceDefault?: boolean;
      soundEnabled?: boolean;
      pushEnabled?: boolean;
    }) =>
      z
        .object({
          fullName: z.string().trim().min(2).max(120).optional(),
          phone: z.string().trim().max(30).optional(),
          hideBalanceDefault: z.boolean().optional(),
          soundEnabled: z.boolean().optional(),
          pushEnabled: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { execute, nowIso } = await import("./d1.server");
    const userId = await requireUserId();

    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.fullName !== undefined) {
      sets.push("full_name = ?");
      params.push(data.fullName);
    }
    if (data.phone !== undefined) {
      sets.push("phone = ?");
      params.push(data.phone || null);
    }
    if (data.hideBalanceDefault !== undefined) {
      sets.push("hide_balance_default = ?");
      params.push(data.hideBalanceDefault);
    }
    if (data.soundEnabled !== undefined) {
      sets.push("sound_enabled = ?");
      params.push(data.soundEnabled);
    }
    if (data.pushEnabled !== undefined) {
      sets.push("push_enabled = ?");
      params.push(data.pushEnabled);
    }
    if (sets.length === 0) return { ok: true as const };

    sets.push("updated_at = ?");
    params.push(nowIso(), userId);
    await execute(`UPDATE profiles SET ${sets.join(", ")} WHERE id = ?`, params);
    return { ok: true as const };
  });

/** Change password while signed in: the current one must be right. */
export const changePassword = createServerFn({ method: "POST" })
  .inputValidator((d: { currentPassword: string; newPassword: string }) =>
    z
      .object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(8).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId, verifyPassword, hashPassword } = await import("./guard.server");
    const { queryOne, execute, nowIso } = await import("./d1.server");

    const userId = await requireUserId();
    const user = await queryOne<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = ?",
      [userId],
    );
    if (!user || !(await verifyPassword(data.currentPassword, user.password_hash))) {
      return { ok: false as const, error: "wrong_password" };
    }
    await execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [
      await hashPassword(data.newPassword),
      nowIso(),
      userId,
    ]);
    return { ok: true as const };
  });

/**
 * Close the account. Blocked while money or a pending trade is still in play,
 * and the password must be re-entered.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) =>
    z.object({ password: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId, verifyPassword, endSession } = await import("./guard.server");
    const { queryOne, execute, nowIso } = await import("./d1.server");

    const userId = await requireUserId();
    const user = await queryOne<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = ?",
      [userId],
    );
    if (!user || !(await verifyPassword(data.password, user.password_hash))) {
      return { ok: false as const, error: "wrong_password" };
    }

    const wallet = await queryOne<{ balance_naira: number; held_naira: number }>(
      "SELECT balance_naira, held_naira FROM wallets WHERE user_id = ?",
      [userId],
    );
    if ((wallet?.balance_naira ?? 0) > 0 || (wallet?.held_naira ?? 0) > 0) {
      return { ok: false as const, error: "has_balance" };
    }
    const pending = await queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM trades WHERE user_id = ? AND status = 'pending'",
      [userId],
    );
    if ((pending?.c ?? 0) > 0) return { ok: false as const, error: "has_pending" };

    await execute("UPDATE profiles SET deleted_at = ?, updated_at = ? WHERE id = ?", [
      nowIso(),
      nowIso(),
      userId,
    ]);
    await endSession();
    return { ok: true as const };
  });
