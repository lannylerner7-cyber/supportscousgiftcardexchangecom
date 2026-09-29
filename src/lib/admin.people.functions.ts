/**
 * Admin desk: members, market rates, contact messages and mail settings.
 * Admin rights are checked in server code on every call, and each change is
 * written to the audit log.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { requireAdminId } = await import("./guard.server");
  return requireAdminId();
}

async function audit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  after: unknown,
) {
  const { execute, newId, nowIso } = await import("./d1.server");
  await execute(
    `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), actorId, action, targetType, targetId, JSON.stringify(after ?? null), nowIso()],
  );
}

/* ------------------------------------------------------------------ members */

/**
 * Member list. The search runs in the database on indexed prefixes, so a long
 * member list never has to be read into the page.
 */
export const adminListUsers = createServerFn({ method: "GET" })
  .inputValidator((d?: { term?: string }) =>
    z.object({ term: z.string().trim().max(120).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    await admin();
    const { query, toNaira } = await import("./d1.server");
    const term = (data.term ?? "").toLowerCase();

    const rows = term
      ? await query<Record<string, unknown>>(
          `SELECT p.id, p.full_name, p.email, p.phone, p.created_at,
                  COALESCE(w.balance_naira, 0) AS balance
             FROM profiles p LEFT JOIN wallets w ON w.user_id = p.id
            WHERE p.deleted_at IS NULL
              AND (LOWER(p.email) LIKE ? OR LOWER(p.full_name) LIKE ?)
            ORDER BY p.created_at DESC LIMIT 200`,
          [`${term}%`, `${term}%`],
        )
      : await query<Record<string, unknown>>(
          `SELECT p.id, p.full_name, p.email, p.phone, p.created_at,
                  COALESCE(w.balance_naira, 0) AS balance
             FROM profiles p LEFT JOIN wallets w ON w.user_id = p.id
            WHERE p.deleted_at IS NULL
            ORDER BY p.created_at DESC LIMIT 200`,
        );

    return rows.map((r) => ({
      id: String(r["id"]),
      full_name: String(r["full_name"] ?? ""),
      email: String(r["email"]),
      phone: (r["phone"] as string | null) ?? null,
      created_at: String(r["created_at"]),
      balance: toNaira(r["balance"]),
    }));
  });

/** One member: profile, balance, banks, cards and money activity. */
export const adminGetUser = createServerFn({ method: "GET" })
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    await admin();
    const { query, queryOne, toNaira } = await import("./d1.server");

    const profile = await queryOne<Record<string, unknown>>(
      `SELECT id, full_name, email, phone, created_at, frozen_at, frozen_reason
         FROM profiles WHERE id = ?`,
      [data.userId],
    );
    if (!profile) return null;

    const wallet = await queryOne<Record<string, unknown>>(
      "SELECT balance_naira, held_naira FROM wallets WHERE user_id = ?",
      [data.userId],
    );
    const banks = await query<Record<string, unknown>>(
      `SELECT id, bank_name, account_number, account_name, is_default
         FROM bank_accounts WHERE user_id = ? ORDER BY is_default DESC`,
      [data.userId],
    );
    const trades = await query<Record<string, unknown>>(
      `SELECT id, brand_name, region_code, currency, face_value, expected_payout,
              paid_amount, status, created_at
         FROM trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [data.userId],
    );
    const txns = await query<Record<string, unknown>>(
      `SELECT id, type, amount, balance_after, note, created_at
         FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [data.userId],
    );

    return {
      profile: {
        id: String(profile["id"]),
        full_name: String(profile["full_name"] ?? ""),
        email: String(profile["email"]),
        phone: (profile["phone"] as string | null) ?? null,
        created_at: String(profile["created_at"]),
        frozen_at: (profile["frozen_at"] as string | null) ?? null,
        frozen_reason: (profile["frozen_reason"] as string | null) ?? null,
      },
      wallet: {
        balance_naira: toNaira(wallet?.["balance_naira"]),
        held_naira: toNaira(wallet?.["held_naira"]),
      },
      banks: banks.map((b) => ({
        id: String(b["id"]),
        bank_name: String(b["bank_name"]),
        account_number: String(b["account_number"]),
        account_name: String(b["account_name"]),
        is_default: Boolean(b["is_default"]),
      })),
      trades: trades.map((t) => ({
        id: String(t["id"]),
        brand_name: String(t["brand_name"]),
        region_code: String(t["region_code"]),
        currency: String(t["currency"]),
        face_value: toNaira(t["face_value"]),
        expected_payout: toNaira(t["expected_payout"]),
        paid_amount: toNaira(t["paid_amount"]),
        status: String(t["status"]),
        created_at: String(t["created_at"]),
      })),
      transactions: txns.map((x) => ({
        id: String(x["id"]),
        type: String(x["type"]),
        amount: toNaira(x["amount"]),
        balance_after: toNaira(x["balance_after"]),
        note: (x["note"] as string | null) ?? null,
        created_at: String(x["created_at"]),
      })),
    };
  });

/** Hand-adjust a balance. The statement line is written in the same batch. */
export const adminAdjustWallet = createServerFn({ method: "POST" })
  .inputValidator((d: { userId: string; amount: number; note?: string }) =>
    z
      .object({
        userId: z.string().min(10),
        amount: z.number().refine((n) => n !== 0, "Enter an amount"),
        note: z.string().trim().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const actorId = await admin();
    const { queryOne, transaction, toKobo, newId, nowIso } = await import("./d1.server");

    const wallet = await queryOne<Record<string, unknown>>(
      "SELECT id, balance_naira FROM wallets WHERE user_id = ?",
      [data.userId],
    );
    if (!wallet) throw new Error("That member has no wallet.");

    const delta = toKobo(Math.abs(data.amount)) * (data.amount < 0 ? -1 : 1);
    const balance = Number(wallet["balance_naira"] ?? 0);
    const next = balance + delta;
    if (next < 0) throw new Error("That would push the balance below zero.");

    const now = nowIso();
    await transaction([
      {
        sql: `UPDATE wallets SET balance_naira = ?, updated_at = ?
               WHERE id = ? AND balance_naira = ?`,
        params: [next, now, String(wallet["id"]), balance],
      },
      {
        sql: `INSERT INTO wallet_transactions (id, wallet_id, user_id, type, amount, balance_after,
                    reference_type, note, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'adjustment', ?, ?)`,
        params: [
          newId(),
          String(wallet["id"]),
          data.userId,
          delta > 0 ? "credit" : "debit",
          Math.abs(delta),
          next,
          data.note ?? "Manual adjustment",
          now,
        ],
      },
      {
        sql: `INSERT INTO notifications (id, user_id, title, body, type, link, created_at)
              VALUES (?, ?, ?, ?, ?, '/app', ?)`,
        params: [
          newId(),
          data.userId,
          delta > 0 ? "Balance credited" : "Balance adjusted",
          data.note ?? null,
          delta > 0 ? "success" : "info",
          now,
        ],
      },
    ]);

    await audit(actorId, "adjust_wallet", "wallet", data.userId, {
      delta,
      note: data.note ?? null,
    });
    return { ok: true as const };
  });

/** Freeze or unfreeze a member. */
export const adminSetFrozen = createServerFn({ method: "POST" })
  .inputValidator((d: { userId: string; frozen: boolean; reason?: string }) =>
    z
      .object({
        userId: z.string().min(10),
        frozen: z.boolean(),
        reason: z.string().trim().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const actorId = await admin();
    const { execute, nowIso } = await import("./d1.server");
    const now = nowIso();
    await execute(
      `UPDATE profiles SET frozen_at = ?, frozen_reason = ?, updated_at = ? WHERE id = ?`,
      [data.frozen ? now : null, data.frozen ? (data.reason ?? null) : null, now, data.userId],
    );
    await audit(actorId, data.frozen ? "freeze_user" : "unfreeze_user", "user", data.userId, {
      reason: data.reason ?? null,
    });
    return { ok: true as const };
  });

/* -------------------------------------------------------------------- rates */

export const adminListBrands = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const { query } = await import("./d1.server");
  const rows = await query<Record<string, unknown>>(
    `SELECT id, name, slug, accent_color, logo_url, is_visible
       FROM gift_card_brands ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    name: String(r["name"]),
    slug: String(r["slug"]),
    accent_color: (r["accent_color"] as string | null) ?? null,
    logo_url: (r["logo_url"] as string | null) ?? null,
    is_visible: Boolean(r["is_visible"]),
  }));
});

export const adminListVariants = createServerFn({ method: "GET" })
  .inputValidator((d: { brandId: string }) => z.object({ brandId: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    await admin();
    const { query, toNaira } = await import("./d1.server");
    const rows = await query<Record<string, unknown>>(
      `SELECT v.id, v.card_type, v.min_value, v.max_value, v.rate_naira, v.is_active,
              r.code, r.name AS region_name, r.currency, r.flag_emoji
         FROM gift_card_variants v
         JOIN gift_card_regions r ON r.id = v.region_id
        WHERE v.brand_id = ?
        ORDER BY r.code ASC, v.card_type ASC`,
      [data.brandId],
    );
    return rows.map((r) => ({
      id: String(r["id"]),
      card_type: String(r["card_type"]),
      min_value: toNaira(r["min_value"]),
      max_value: toNaira(r["max_value"]),
      rate_naira: toNaira(r["rate_naira"]),
      is_active: Boolean(r["is_active"]),
      region: {
        code: String(r["code"]),
        name: String(r["region_name"]),
        currency: String(r["currency"]),
        flag_emoji: (r["flag_emoji"] as string | null) ?? null,
      },
    }));
  });

export const adminSetBrandVisible = createServerFn({ method: "POST" })
  .inputValidator((d: { brandId: string; visible: boolean }) =>
    z.object({ brandId: z.string().min(10), visible: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const actorId = await admin();
    const { execute, nowIso } = await import("./d1.server");
    await execute("UPDATE gift_card_brands SET is_visible = ?, updated_at = ? WHERE id = ?", [
      data.visible ? 1 : 0,
      nowIso(),
      data.brandId,
    ]);
    await audit(actorId, "brand_visibility", "brand", data.brandId, { visible: data.visible });
    return { ok: true as const };
  });

export const adminSetRate = createServerFn({ method: "POST" })
  .inputValidator((d: { variantId: string; rate: number }) =>
    z.object({ variantId: z.string().min(10), rate: z.number().min(0).max(100000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const actorId = await admin();
    const { execute, toKobo, nowIso } = await import("./d1.server");
    await execute("UPDATE gift_card_variants SET rate_naira = ?, updated_at = ? WHERE id = ?", [
      toKobo(data.rate),
      nowIso(),
      data.variantId,
    ]);
    await audit(actorId, "set_rate", "variant", data.variantId, { rate: data.rate });
    return { ok: true as const };
  });

export const adminSetVariantActive = createServerFn({ method: "POST" })
  .inputValidator((d: { variantId: string; active: boolean }) =>
    z.object({ variantId: z.string().min(10), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const actorId = await admin();
    const { execute, nowIso } = await import("./d1.server");
    await execute("UPDATE gift_card_variants SET is_active = ?, updated_at = ? WHERE id = ?", [
      data.active ? 1 : 0,
      nowIso(),
      data.variantId,
    ]);
    await audit(actorId, "variant_active", "variant", data.variantId, { active: data.active });
    return { ok: true as const };
  });

/* ----------------------------------------------------------------- messages */

export const adminListMessages = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const { query } = await import("./d1.server");
  const rows = await query<Record<string, unknown>>(
    `SELECT id, name, email, message, read_at, created_at
       FROM contact_messages ORDER BY created_at DESC LIMIT 200`,
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    name: String(r["name"]),
    email: String(r["email"]),
    message: String(r["message"]),
    read_at: (r["read_at"] as string | null) ?? null,
    created_at: String(r["created_at"]),
  }));
});

export const adminSetMessageRead = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; read: boolean }) =>
    z.object({ id: z.string().min(10), read: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    await admin();
    const { execute, nowIso } = await import("./d1.server");
    await execute("UPDATE contact_messages SET read_at = ? WHERE id = ?", [
      data.read ? nowIso() : null,
      data.id,
    ]);
    return { ok: true as const };
  });

/* ------------------------------------------------------------ mail settings */

export const adminMailSettings = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const { queryOne } = await import("./d1.server");
  const row = await queryOne<Record<string, unknown>>(
    "SELECT alert_emails, from_name, reply_to FROM app_settings WHERE id = 1",
  );
  let emails: string[] = [];
  try {
    const parsed = JSON.parse(String(row?.["alert_emails"] ?? "[]"));
    if (Array.isArray(parsed)) emails = parsed.map((e) => String(e));
  } catch {
    emails = [];
  }
  return {
    alert_emails: emails,
    from_name: String(row?.["from_name"] ?? "ScousGiftCardExchange"),
    reply_to: (row?.["reply_to"] as string | null) ?? null,
  };
});

export const adminSaveMailSettings = createServerFn({ method: "POST" })
  .inputValidator((d: { emails: string[]; fromName?: string; replyTo?: string }) =>
    z
      .object({
        emails: z.array(z.string().email().max(200)).max(10),
        fromName: z.string().trim().max(60).optional(),
        replyTo: z.string().trim().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const actorId = await admin();
    const { execute, nowIso } = await import("./d1.server");
    const emails = Array.from(new Set(data.emails.map((e) => e.trim().toLowerCase())));
    await execute(
      `INSERT INTO app_settings (id, alert_emails, from_name, reply_to, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET alert_emails = excluded.alert_emails,
              from_name = excluded.from_name, reply_to = excluded.reply_to,
              updated_at = excluded.updated_at`,
      [
        JSON.stringify(emails),
        data.fromName?.trim() || "ScousGiftCardExchange",
        data.replyTo?.trim() || null,
        nowIso(),
      ],
    );
    await audit(actorId, "mail_settings", "app_settings", null, { emails });
    return { ok: true as const };
  });

const SPAM_WORDS = [
  "free",
  "winner",
  "guarantee",
  "act now",
  "urgent",
  "cash bonus",
  "click here",
  "limited time",
  "risk free",
  "no cost",
  "double your",
  "make money",
  "credit card",
  "lottery",
  "prize",
  "investment",
  "crypto",
  "loan",
];

/** Flags words that often push an email into the spam folder. */
export const checkSpamWords = createServerFn({ method: "POST" })
  .inputValidator((d: { text: string }) => z.object({ text: z.string().max(5000) }).parse(d))
  .handler(async ({ data }) => {
    await admin();
    const text = data.text.toLowerCase();
    return { hits: SPAM_WORDS.filter((w) => text.includes(w)) };
  });
