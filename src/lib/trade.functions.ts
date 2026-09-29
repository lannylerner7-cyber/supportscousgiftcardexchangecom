/**
 * Trades: submitting a card, listing your own trades, and reading one trade.
 *
 * The payout is always recalculated on the server from the live rate — the
 * amount the browser shows is never trusted.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MAX_FACE_VALUE = 5000;

export type TradeListItem = {
  id: string;
  brand_name: string;
  region_code: string;
  card_type: string;
  face_value: number;
  currency: string;
  expected_payout: number;
  paid_amount: number;
  status: string;
  created_at: string;
};

const LIST_COLUMNS = `id, brand_name, region_code, card_type, face_value, currency,
                      expected_payout, paid_amount, status, created_at`;

function shapeTrade(r: Record<string, unknown>, toNaira: (v: unknown) => number): TradeListItem {
  return {
    id: String(r["id"]),
    brand_name: String(r["brand_name"]),
    region_code: String(r["region_code"]),
    card_type: String(r["card_type"]),
    face_value: Number(r["face_value"] ?? 0),
    currency: String(r["currency"] ?? "USD"),
    expected_payout: toNaira(r["expected_payout"]),
    paid_amount: toNaira(r["paid_amount"]),
    status: String(r["status"]),
    created_at: String(r["created_at"]),
  };
}

/** The signed-in member's trades, newest first. */
export const listMyTrades = createServerFn({ method: "GET" })
  .inputValidator((d?: { limit?: number }) =>
    z.object({ limit: z.number().int().min(1).max(200).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<TradeListItem[]> => {
    const { requireUserId } = await import("./guard.server");
    const { query, toNaira } = await import("./d1.server");
    const userId = await requireUserId();
    const rows = await query<Record<string, unknown>>(
      `SELECT ${LIST_COLUMNS} FROM trades WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?`,
      [userId, data.limit ?? 100],
    );
    return rows.map((r) => shapeTrade(r, toNaira));
  });

/** One of the member's own trades, with its proof images. */
export const getMyTrade = createServerFn({ method: "GET" })
  .inputValidator((d: { tradeId: string }) => z.object({ tradeId: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { query, queryOne, toNaira } = await import("./d1.server");
    const userId = await requireUserId();

    const row = await queryOne<Record<string, unknown>>(
      `SELECT ${LIST_COLUMNS}, rate_at_submit, admin_note, user_note, ecode, reviewed_at
         FROM trades WHERE id = ? AND user_id = ? LIMIT 1`,
      [data.tradeId, userId],
    );
    if (!row) return null;

    const images = await query<{ id: string; storage_path: string }>(
      "SELECT id, storage_path FROM trade_images WHERE trade_id = ? ORDER BY created_at ASC",
      [data.tradeId],
    );

    return {
      ...shapeTrade(row, toNaira),
      rate_at_submit: toNaira(row["rate_at_submit"]),
      admin_note: (row["admin_note"] as string | null) ?? null,
      user_note: (row["user_note"] as string | null) ?? null,
      ecode: (row["ecode"] as string | null) ?? null,
      reviewed_at: (row["reviewed_at"] as string | null) ?? null,
      images: images.map((i) => ({ id: i.id, path: i.storage_path })),
    };
  });

/** Submit a card for review. */
export const createTrade = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      variantId: string;
      faceValue: number;
      ecode?: string;
      ecodePin?: string;
      note?: string;
    }) =>
      z
        .object({
          variantId: z.string().min(10),
          faceValue: z.number().positive().max(MAX_FACE_VALUE),
          ecode: z.string().trim().max(200).optional(),
          ecodePin: z.string().trim().max(50).optional(),
          note: z.string().trim().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { queryOne, execute, newId, nowIso, toNaira } = await import("./d1.server");

    const userId = await requireUserId();
    const profile = await queryOne<{ frozen_at: string | null }>(
      "SELECT frozen_at FROM profiles WHERE id = ?",
      [userId],
    );
    if (profile?.frozen_at) throw new Error("Your account is on hold. Please contact support.");

    const variant = await queryOne<Record<string, unknown>>(
      `SELECT v.id, v.brand_id, v.region_id, v.card_type, v.min_value, v.max_value, v.rate_naira,
              b.name AS brand_name, r.code AS region_code, r.currency
         FROM gift_card_variants v
         JOIN gift_card_brands b ON b.id = v.brand_id
         JOIN gift_card_regions r ON r.id = v.region_id
        WHERE v.id = ? AND v.is_active = 1 LIMIT 1`,
      [data.variantId],
    );
    if (!variant) throw new Error("That card is no longer available.");

    // min/max are stored in kobo of the card's own currency, like all money here.
    const min = toNaira(variant["min_value"]);
    const max = toNaira(variant["max_value"]);
    const faceUnits = Math.round(data.faceValue);
    if (min > 0 && faceUnits < min) throw new Error(`The smallest card we take is ${min}.`);
    if (max > 0 && faceUnits > max) throw new Error(`The largest card we take is ${max}.`);

    const rateKobo = Number(variant["rate_naira"] ?? 0);
    if (rateKobo <= 0) throw new Error("This card has no rate yet. Please try another.");

    const expectedPayout = faceUnits * rateKobo;
    const tradeId = newId();
    const now = nowIso();

    await execute(
      `INSERT INTO trades (id, user_id, brand_id, region_id, variant_id, brand_name, region_code,
                           card_type, face_value, currency, rate_at_submit, expected_payout,
                           status, user_note, ecode, ecode_pin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        tradeId,
        userId,
        variant["brand_id"],
        variant["region_id"],
        variant["id"],
        variant["brand_name"],
        variant["region_code"],
        variant["card_type"],
        faceUnits,
        variant["currency"],
        rateKobo,
        expectedPayout,
        data.note ?? null,
        data.ecode ?? null,
        data.ecodePin ?? null,
        now,
        now,
      ],
    );

    await execute(
      `INSERT INTO notifications (id, user_id, title, body, type, link, created_at)
       VALUES (?, ?, ?, ?, 'info', ?, ?)`,
      [
        newId(),
        userId,
        "Card submitted",
        `${String(variant["brand_name"])} ${String(variant["currency"])} ${faceUnits} is now pending review.`,
        `/app/history/${tradeId}`,
        now,
      ],
    );

    return { id: tradeId, user_id: userId, expected_payout: toNaira(expectedPayout) };
  });
