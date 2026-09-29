/**
 * Wallet, bank accounts and withdrawals.
 *
 * Money is stored as whole kobo and every balance change is written together
 * with its statement line in a single all-or-nothing batch, so a balance can
 * never move without a matching record.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const WITHDRAWAL_FEE_NAIRA = 300;
const MIN_WITHDRAWAL_NAIRA = 1000;

export const getWallet = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { queryOne, toNaira } = await import("./d1.server");
  const userId = await requireUserId();
  const row = await queryOne<Record<string, unknown>>(
    "SELECT balance_naira, held_naira, locked_naira FROM wallets WHERE user_id = ?",
    [userId],
  );
  return {
    balance_naira: toNaira(row?.["balance_naira"]),
    held_naira: toNaira(row?.["held_naira"]),
    locked_naira: toNaira(row?.["locked_naira"]),
  };
});

export const listTransactions = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { query, toNaira } = await import("./d1.server");
  const userId = await requireUserId();
  const rows = await query<Record<string, unknown>>(
    `SELECT id, type, amount, balance_after, reference_type, reference_id, note, created_at
       FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    [userId],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    type: String(r["type"]),
    amount: toNaira(r["amount"]),
    balance_after: toNaira(r["balance_after"]),
    reference_type: (r["reference_type"] as string | null) ?? null,
    reference_id: (r["reference_id"] as string | null) ?? null,
    note: (r["note"] as string | null) ?? null,
    created_at: String(r["created_at"]),
  }));
});

/* ------------------------------------------------------------ bank accounts */

export const listMyBankAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { query } = await import("./d1.server");
  const userId = await requireUserId();
  const rows = await query<Record<string, unknown>>(
    `SELECT id, bank_name, account_number, account_name, is_default
       FROM bank_accounts WHERE user_id = ? ORDER BY is_default DESC, created_at ASC`,
    [userId],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    bank_name: String(r["bank_name"]),
    account_number: String(r["account_number"]),
    account_name: String(r["account_name"]),
    is_default: Boolean(r["is_default"]),
  }));
});

export const addBankAccount = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { bankId: string; accountNumber: string; accountName: string; makeDefault?: boolean }) =>
      z
        .object({
          bankId: z.string().min(10),
          accountNumber: z.string().trim().regex(/^\d{10}$/),
          accountName: z.string().trim().min(3).max(120),
          makeDefault: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { queryOne, transaction, newId, nowIso } = await import("./d1.server");
    const userId = await requireUserId();

    const bank = await queryOne<{ name: string; code: string | null }>(
      "SELECT name, code FROM banks WHERE id = ? AND is_active = 1",
      [data.bankId],
    );
    if (!bank) return { ok: false as const, error: "unknown_bank" };

    const existing = await queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM bank_accounts WHERE user_id = ?",
      [userId],
    );
    const count = existing?.c ?? 0;
    if (count >= 5) return { ok: false as const, error: "too_many" };

    const makeDefault = data.makeDefault || count === 0;
    const id = newId();
    const statements = [];
    if (makeDefault) {
      statements.push({
        sql: "UPDATE bank_accounts SET is_default = 0 WHERE user_id = ?",
        params: [userId],
      });
    }
    statements.push({
      sql: `INSERT INTO bank_accounts (id, user_id, bank_id, bank_name, bank_code,
                                       account_number, account_name, is_default, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        userId,
        data.bankId,
        bank.name,
        bank.code,
        data.accountNumber,
        data.accountName,
        makeDefault ? 1 : 0,
        nowIso(),
      ],
    });
    await transaction(statements);
    return { ok: true as const, id };
  });

export const removeBankAccount = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { execute } = await import("./d1.server");
    const userId = await requireUserId();
    await execute("DELETE FROM bank_accounts WHERE id = ? AND user_id = ?", [data.id, userId]);
    return { ok: true as const };
  });

export const setDefaultBankAccount = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { transaction } = await import("./d1.server");
    const userId = await requireUserId();
    await transaction([
      { sql: "UPDATE bank_accounts SET is_default = 0 WHERE user_id = ?", params: [userId] },
      {
        sql: "UPDATE bank_accounts SET is_default = 1 WHERE id = ? AND user_id = ?",
        params: [data.id, userId],
      },
    ]);
    return { ok: true as const };
  });

/* ------------------------------------------------------------- withdrawals */

export const listMyWithdrawals = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { query, toNaira } = await import("./d1.server");
  const userId = await requireUserId();
  const rows = await query<Record<string, unknown>>(
    `SELECT id, amount, fee, net_amount, status, bank_snapshot, created_at
       FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    [userId],
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
      amount: toNaira(r["amount"]),
      fee: toNaira(r["fee"]),
      net_amount: toNaira(r["net_amount"]),
      status: String(r["status"]),
      bank_snapshot: snapshot,
      created_at: String(r["created_at"]),
    };
  });
});

/** Withdrawal PIN and account state for the withdrawal screen. */
export const withdrawalPinStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { queryOne } = await import("./d1.server");
  const userId = await requireUserId();
  const row = await queryOne<Record<string, unknown>>(
    `SELECT withdrawal_pin_hash, pin_locked_until, frozen_at, frozen_reason
       FROM profiles WHERE id = ?`,
    [userId],
  );
  return {
    has_pin: Boolean(row?.["withdrawal_pin_hash"]),
    locked_until: (row?.["pin_locked_until"] as string | null) ?? null,
    frozen: Boolean(row?.["frozen_at"]),
    frozen_reason: (row?.["frozen_reason"] as string | null) ?? null,
  };
});

/**
 * Request a payout. The balance is debited immediately and the statement line
 * written in the same batch, so the money cannot be spent twice.
 */
export const createWithdrawal = createServerFn({ method: "POST" })
  .inputValidator((d: { bankAccountId: string; amount: number; pin: string }) =>
    z
      .object({
        bankAccountId: z.string().min(10),
        amount: z.number().positive().max(50_000_000),
        pin: z.string().regex(/^\d{4}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { queryOne, transaction, toKobo, newId, nowIso } = await import("./d1.server");
    const { pinMatches } = await import("./pin.functions");
    const { execute } = await import("./d1.server");

    const userId = await requireUserId();
    const profile = await queryOne<Record<string, unknown>>(
      "SELECT frozen_at, pin_attempts, pin_locked_until FROM profiles WHERE id = ?",
      [userId],
    );
    if (profile?.["frozen_at"]) throw new Error("Your account is on hold. Please contact support.");
    const lockedUntil = profile?.["pin_locked_until"] as string | null;
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      throw new Error("Too many wrong PIN entries. Try again later.");
    }

    if (!(await pinMatches(userId, data.pin))) {
      const attempts = Number(profile?.["pin_attempts"] ?? 0) + 1;
      const lock = attempts >= 3 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;
      await execute(
        "UPDATE profiles SET pin_attempts = ?, pin_locked_until = ?, updated_at = ? WHERE id = ?",
        [attempts >= 3 ? 0 : attempts, lock, nowIso(), userId],
      );
      throw new Error(
        lock ? "Wrong PIN. Withdrawals are paused for 30 minutes." : "That PIN is not correct.",
      );
    }
    await execute("UPDATE profiles SET pin_attempts = 0, pin_locked_until = NULL WHERE id = ?", [
      userId,
    ]);

    if (data.amount < MIN_WITHDRAWAL_NAIRA) {
      throw new Error(`The smallest withdrawal is ₦${MIN_WITHDRAWAL_NAIRA.toLocaleString()}.`);
    }

    const bank = await queryOne<Record<string, unknown>>(
      `SELECT id, bank_name, bank_code, account_number, account_name
         FROM bank_accounts WHERE id = ? AND user_id = ?`,
      [data.bankAccountId, userId],
    );
    if (!bank) throw new Error("Choose one of your saved bank accounts.");

    const wallet = await queryOne<Record<string, unknown>>(
      "SELECT id, balance_naira, held_naira, locked_naira FROM wallets WHERE user_id = ?",
      [userId],
    );
    if (!wallet) throw new Error("Your wallet is not ready yet.");

    const amountKobo = toKobo(data.amount);
    const feeKobo = toKobo(WITHDRAWAL_FEE_NAIRA);
    if (amountKobo <= feeKobo) {
      throw new Error(`The amount must be more than the ₦${WITHDRAWAL_FEE_NAIRA} fee.`);
    }

    const balance = Number(wallet["balance_naira"] ?? 0);
    const locked = Number(wallet["locked_naira"] ?? 0);
    const available = balance - locked;
    if (amountKobo > available) throw new Error("That is more than your available balance.");

    const withdrawalId = newId();
    const now = nowIso();
    const newBalance = balance - amountKobo;
    const snapshot = JSON.stringify({
      bank_name: String(bank["bank_name"]),
      bank_code: (bank["bank_code"] as string | null) ?? "",
      account_number: String(bank["account_number"]),
      account_name: String(bank["account_name"]),
    });

    await transaction([
      {
        sql: `INSERT INTO withdrawals (id, user_id, bank_account_id, bank_snapshot, amount, fee,
                                       net_amount, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
        params: [
          withdrawalId,
          userId,
          String(bank["id"]),
          snapshot,
          amountKobo,
          feeKobo,
          amountKobo - feeKobo,
          now,
          now,
        ],
      },
      {
        sql: `UPDATE wallets SET balance_naira = ?, held_naira = held_naira + ?, updated_at = ?
               WHERE id = ? AND balance_naira = ?`,
        params: [newBalance, amountKobo, now, String(wallet["id"]), balance],
      },
      {
        sql: `INSERT INTO wallet_transactions (id, wallet_id, user_id, type, amount, balance_after,
                                              reference_type, reference_id, note, created_at)
              VALUES (?, ?, ?, 'debit', ?, ?, 'withdrawal', ?, ?, ?)`,
        params: [
          newId(),
          String(wallet["id"]),
          userId,
          amountKobo,
          newBalance,
          withdrawalId,
          "Withdrawal requested",
          now,
        ],
      },
      {
        sql: `INSERT INTO notifications (id, user_id, title, body, type, link, created_at)
              VALUES (?, ?, ?, ?, 'info', '/app/withdraw', ?)`,
        params: [
          newId(),
          userId,
          "Withdrawal requested",
          `₦${data.amount.toLocaleString("en-NG")} is being processed.`,
          now,
        ],
      },
    ]);

    return { id: withdrawalId };
  });
