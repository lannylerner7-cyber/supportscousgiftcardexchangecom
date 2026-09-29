/**
 * Admin desk: overview figures, trade review, withdrawal decisions, audit log.
 *
 * Every function checks the caller is an admin in server code (the database
 * itself has no per-row rules), and every decision that moves money writes the
 * balance change, the statement line, the member's notification and the audit
 * entry in one all-or-nothing batch.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TRADE_COLUMNS = `id, user_id, brand_name, region_code, card_type, face_value, currency,
  expected_payout, paid_amount, status, created_at, flagged_duplicate`;

async function admin() {
  const { requireAdminId } = await import("./guard.server");
  return requireAdminId();
}

/** Overview figures for the admin home. */
export const adminStats = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const { queryOne, toNaira } = await import("./d1.server");

  const wallets = await queryOne<Record<string, unknown>>(
    "SELECT COALESCE(SUM(balance_naira),0) AS bal, COALESCE(SUM(held_naira),0) AS held FROM wallets",
  );
  const trades = await queryOne<Record<string, unknown>>(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('successful','partially_paid') THEN paid_amount END),0) AS redeemed,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending
       FROM trades`,
  );
  const withdrawals = await queryOne<Record<string, unknown>>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN net_amount END),0) AS paid_out,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN fee END),0) AS fees,
            COUNT(CASE WHEN status IN ('requested','approved') THEN 1 END) AS pending
       FROM withdrawals`,
  );
  const members = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM profiles WHERE deleted_at IS NULL",
  );
  const volume = await queryOne<Record<string, unknown>>(
    `SELECT COUNT(CASE WHEN created_at >= ? THEN 1 END) AS today,
            COUNT(CASE WHEN created_at >= ? THEN 1 END) AS week
       FROM trades`,
    [
      new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    ],
  );
  const unread = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM contact_messages WHERE read_at IS NULL",
  );

  return {
    member_balance: toNaira(wallets?.["bal"]),
    held: toNaira(wallets?.["held"]),
    redeemed_value: toNaira(trades?.["redeemed"]),
    paid_out: toNaira(withdrawals?.["paid_out"]),
    fees: toNaira(withdrawals?.["fees"]),
    pending_trades: Number(trades?.["pending"] ?? 0),
    pending_withdrawals: Number(withdrawals?.["pending"] ?? 0),
    members: Number(members?.c ?? 0),
    trades_today: Number(volume?.["today"] ?? 0),
    trades_week: Number(volume?.["week"] ?? 0),
    unread_messages: Number(unread?.c ?? 0),
  };
});

function shapeTradeRow(r: Record<string, unknown>, toNaira: (v: unknown) => number) {
  return {
    id: String(r["id"]),
    user_id: String(r["user_id"]),
    brand_name: String(r["brand_name"]),
    region_code: String(r["region_code"]),
    card_type: String(r["card_type"] ?? "physical"),
    face_value: toNaira(r["face_value"]),
    currency: String(r["currency"]),
    expected_payout: toNaira(r["expected_payout"]),
    paid_amount: toNaira(r["paid_amount"]),
    status: String(r["status"]),
    created_at: String(r["created_at"]),
    flagged_duplicate: Boolean(r["flagged_duplicate"]),
  };
}

export const adminListTrades = createServerFn({ method: "GET" })
  .inputValidator((d?: { status?: string; limit?: number }) =>
    z
      .object({ status: z.string().optional(), limit: z.number().int().min(1).max(200).optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    await admin();
    const { query, toNaira } = await import("./d1.server");
    const limit = data.limit ?? 100;
    const rows =
      data.status && data.status !== "all"
        ? await query<Record<string, unknown>>(
            `SELECT ${TRADE_COLUMNS} FROM trades WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
            [data.status, limit],
          )
        : await query<Record<string, unknown>>(
            `SELECT ${TRADE_COLUMNS} FROM trades ORDER BY created_at DESC LIMIT ?`,
            [limit],
          );
    return rows.map((r) => shapeTradeRow(r, toNaira));
  });

/** One trade with the member and the uploaded photos. */
export const adminGetTrade = createServerFn({ method: "GET" })
  .inputValidator((d: { tradeId: string }) => z.object({ tradeId: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    await admin();
    const { query, queryOne, toNaira } = await import("./d1.server");

    const row = await queryOne<Record<string, unknown>>(
      `SELECT ${TRADE_COLUMNS}, rate_at_submit, ecode, ecode_pin, user_note, admin_note, reviewed_at
         FROM trades WHERE id = ?`,
      [data.tradeId],
    );
    if (!row) return null;

    const member = await queryOne<Record<string, unknown>>(
      "SELECT id, full_name, email, phone FROM profiles WHERE id = ?",
      [String(row["user_id"])],
    );
    const images = await query<{ id: string; storage_path: string }>(
      "SELECT id, storage_path FROM trade_images WHERE trade_id = ? ORDER BY created_at ASC",
      [data.tradeId],
    );

    return {
      ...shapeTradeRow(row, toNaira),
      rate_at_submit: toNaira(row["rate_at_submit"]),
      ecode: (row["ecode"] as string | null) ?? null,
      ecode_pin: (row["ecode_pin"] as string | null) ?? null,
      user_note: (row["user_note"] as string | null) ?? null,
      admin_note: (row["admin_note"] as string | null) ?? null,
      reviewed_at: (row["reviewed_at"] as string | null) ?? null,
      member: member
        ? {
            id: String(member["id"]),
            full_name: String(member["full_name"] ?? ""),
            email: String(member["email"]),
            phone: (member["phone"] as string | null) ?? null,
          }
        : null,
      images: images.map((i) => ({ id: i.id, path: i.storage_path })),
    };
  });

/**
 * Approve, part-pay or decline a card. An approved card credits the member's
 * balance and writes its statement line in the same batch.
 */
export const adminReviewTrade = createServerFn({ method: "POST" })
  .inputValidator((d: { tradeId: string; status: string; paid?: number; note?: string }) =>
    z
      .object({
        tradeId: z.string().min(10),
        status: z.enum(["successful", "partially_paid", "used", "error"]),
        paid: z.number().min(0).max(50_000_000).optional(),
        note: z.string().trim().max(600).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const adminId = await admin();
    const { queryOne, transaction, toKobo, newId, nowIso } = await import("./d1.server");

    const trade = await queryOne<Record<string, unknown>>(
      "SELECT id, user_id, status, expected_payout, brand_name FROM trades WHERE id = ?",
      [data.tradeId],
    );
    if (!trade) throw new Error("That card no longer exists.");
    if (String(trade["status"]) !== "pending") throw new Error("This card was already reviewed.");

    const userId = String(trade["user_id"]);
    const expected = Number(trade["expected_payout"] ?? 0);
    const credited =
      data.status === "successful"
        ? expected
        : data.status === "partially_paid"
          ? toKobo(data.paid ?? 0)
          : 0;
    if (data.status === "partially_paid" && (credited <= 0 || credited > expected)) {
      throw new Error("The part payment must be more than zero and no more than the full payout.");
    }

    const now = nowIso();
    const statements: { sql: string; params?: unknown[] }[] = [
      {
        sql: `UPDATE trades SET status = ?, paid_amount = ?, admin_note = ?, reviewed_by = ?,
                     reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
        params: [data.status, credited, data.note ?? null, adminId, now, now, data.tradeId],
      },
    ];

    if (credited > 0) {
      const wallet = await queryOne<Record<string, unknown>>(
        "SELECT id, balance_naira FROM wallets WHERE user_id = ?",
        [userId],
      );
      if (!wallet) throw new Error("That member has no wallet.");
      const balance = Number(wallet["balance_naira"] ?? 0);
      statements.push(
        {
          sql: `UPDATE wallets SET balance_naira = ?, updated_at = ?
                 WHERE id = ? AND balance_naira = ?`,
          params: [balance + credited, now, String(wallet["id"]), balance],
        },
        {
          sql: `INSERT INTO wallet_transactions (id, wallet_id, user_id, type, amount, balance_after,
                      reference_type, reference_id, note, created_at)
                VALUES (?, ?, ?, 'credit', ?, ?, 'trade', ?, ?, ?)`,
          params: [
            newId(),
            String(wallet["id"]),
            userId,
            credited,
            balance + credited,
            data.tradeId,
            `${String(trade["brand_name"])} redeemed`,
            now,
          ],
        },
      );
    }

    const title =
      data.status === "successful"
        ? "Card redeemed"
        : data.status === "partially_paid"
          ? "Card partly redeemed"
          : data.status === "used"
            ? "Card already used"
            : "Card declined";

    statements.push(
      {
        sql: `INSERT INTO notifications (id, user_id, title, body, type, link, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newId(),
          userId,
          title,
          data.note ?? `${String(trade["brand_name"])} — ${title.toLowerCase()}.`,
          credited > 0 ? "success" : "error",
          `/app/history/${data.tradeId}`,
          now,
        ],
      },
      {
        sql: `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, after, created_at)
              VALUES (?, ?, 'review_trade', 'trade', ?, ?, ?)`,
        params: [
          newId(),
          adminId,
          data.tradeId,
          JSON.stringify({ status: data.status, paid: credited }),
          now,
        ],
      },
    );

    await transaction(statements);
    return { ok: true as const };
  });

/* ------------------------------------------------------------ withdrawals */

export const adminListWithdrawals = createServerFn({ method: "GET" })
  .inputValidator((d?: { status?: string }) =>
    z.object({ status: z.string().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    await admin();
    const { query, toNaira } = await import("./d1.server");
    const cols = `id, user_id, amount, fee, net_amount, status, bank_snapshot, created_at`;
    const rows =
      data.status && data.status !== "all"
        ? await query<Record<string, unknown>>(
            `SELECT ${cols} FROM withdrawals WHERE status = ? ORDER BY created_at DESC LIMIT 100`,
            [data.status],
          )
        : await query<Record<string, unknown>>(
            `SELECT ${cols} FROM withdrawals ORDER BY created_at DESC LIMIT 100`,
          );
    return rows.map((r) => {
      let snapshot: Record<string, string> = {};
      try {
        snapshot = JSON.parse(String(r["bank_snapshot"] ?? "{}"));
      } catch {
        snapshot = {};
      }
      return {
        id: String(r["id"]),
        user_id: String(r["user_id"]),
        amount: toNaira(r["amount"]),
        fee: toNaira(r["fee"]),
        net_amount: toNaira(r["net_amount"]),
        status: String(r["status"]),
        bank_snapshot: snapshot,
        created_at: String(r["created_at"]),
      };
    });
  });

/**
 * Approve, mark paid or cancel a payout. Cancelling returns the money to the
 * member's balance in the same batch that releases the hold.
 */
export const adminWithdrawalDecision = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; status: string; note?: string }) =>
    z
      .object({
        id: z.string().min(10),
        status: z.enum(["approved", "paid", "cancelled"]),
        note: z.string().trim().max(600).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const adminId = await admin();
    const { queryOne, transaction, newId, nowIso } = await import("./d1.server");

    const row = await queryOne<Record<string, unknown>>(
      "SELECT id, user_id, amount, net_amount, status FROM withdrawals WHERE id = ?",
      [data.id],
    );
    if (!row) throw new Error("That withdrawal no longer exists.");
    const current = String(row["status"]);
    if (current === "paid" || current === "cancelled") {
      throw new Error("This withdrawal is already finished.");
    }

    const userId = String(row["user_id"]);
    const amount = Number(row["amount"] ?? 0);
    const now = nowIso();
    const statements: { sql: string; params?: unknown[] }[] = [
      {
        sql: `UPDATE withdrawals SET status = ?, admin_note = ?, processed_by = ?,
                     processed_at = ?, updated_at = ? WHERE id = ? AND status = ?`,
        params: [data.status, data.note ?? null, adminId, now, now, data.id, current],
      },
    ];

    const wallet = await queryOne<Record<string, unknown>>(
      "SELECT id, balance_naira, held_naira FROM wallets WHERE user_id = ?",
      [userId],
    );
    if (!wallet) throw new Error("That member has no wallet.");
    const balance = Number(wallet["balance_naira"] ?? 0);

    if (data.status === "paid") {
      // The hold is released; the money already left the balance on request.
      statements.push({
        sql: `UPDATE wallets SET held_naira = MAX(held_naira - ?, 0), updated_at = ? WHERE id = ?`,
        params: [amount, now, String(wallet["id"])],
      });
    }

    if (data.status === "cancelled") {
      statements.push(
        {
          sql: `UPDATE wallets SET balance_naira = ?, held_naira = MAX(held_naira - ?, 0),
                       updated_at = ? WHERE id = ? AND balance_naira = ?`,
          params: [balance + amount, amount, now, String(wallet["id"]), balance],
        },
        {
          sql: `INSERT INTO wallet_transactions (id, wallet_id, user_id, type, amount, balance_after,
                      reference_type, reference_id, note, created_at)
                VALUES (?, ?, ?, 'credit', ?, ?, 'withdrawal', ?, ?, ?)`,
          params: [
            newId(),
            String(wallet["id"]),
            userId,
            amount,
            balance + amount,
            data.id,
            "Withdrawal cancelled — money returned",
            now,
          ],
        },
      );
    }

    const title =
      data.status === "paid"
        ? "Withdrawal paid"
        : data.status === "approved"
          ? "Withdrawal approved"
          : "Withdrawal cancelled";

    statements.push(
      {
        sql: `INSERT INTO notifications (id, user_id, title, body, type, link, created_at)
              VALUES (?, ?, ?, ?, ?, '/app/withdraw', ?)`,
        params: [
          newId(),
          userId,
          title,
          data.note ?? null,
          data.status === "cancelled" ? "error" : "success",
          now,
        ],
      },
      {
        sql: `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, after, created_at)
              VALUES (?, ?, 'withdrawal_decision', 'withdrawal', ?, ?, ?)`,
        params: [newId(), adminId, data.id, JSON.stringify({ status: data.status }), now],
      },
    );

    await transaction(statements);
    return { ok: true as const };
  });

/* --------------------------------------------------------------- audit log */

export const adminAuditLog = createServerFn({ method: "GET" }).handler(async () => {
  await admin();
  const { query } = await import("./d1.server");
  const rows = await query<Record<string, unknown>>(
    `SELECT id, action, target_type, target_id, after, created_at
       FROM admin_audit_log ORDER BY created_at DESC LIMIT 200`,
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    action: String(r["action"]),
    target_type: (r["target_type"] as string | null) ?? null,
    target_id: (r["target_id"] as string | null) ?? null,
    after: (r["after"] as string | null) ?? null,
    created_at: String(r["created_at"]),
  }));
});
