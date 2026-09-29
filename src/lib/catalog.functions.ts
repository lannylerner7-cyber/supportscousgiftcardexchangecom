/**
 * Public catalogue reads: brands, regions, rates and campaign banners.
 *
 * These are the only rows anyone may read without signing in, so each query
 * lists its columns explicitly and filters to visible/active rows. Rates are
 * returned in naira; they are stored as kobo.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type BrandRow = {
  id: string;
  name: string;
  slug: string;
  accent_color: string | null;
  logo_url: string | null;
};

export type VariantRow = {
  id: string;
  rate_naira: number;
  card_type: string;
  min_value: number;
  max_value: number;
  region_id: string;
  gift_card_brands: BrandRow | null;
  gift_card_regions: {
    id: string;
    code: string;
    name: string;
    currency: string;
    flag_emoji: string | null;
  } | null;
};

const VARIANT_SELECT = `
  SELECT v.id, v.rate_naira, v.card_type, v.min_value, v.max_value,
         b.id AS b_id, b.name AS b_name, b.slug AS b_slug,
         b.accent_color AS b_accent, b.logo_url AS b_logo,
         r.id AS r_id, r.code AS r_code, r.name AS r_name, r.currency AS r_currency,
         r.flag_emoji AS r_flag
    FROM gift_card_variants v
    JOIN gift_card_brands b ON b.id = v.brand_id
    JOIN gift_card_regions r ON r.id = v.region_id`;

function shapeVariant(row: Record<string, unknown>, toNaira: (v: unknown) => number): VariantRow {
  return {
    id: String(row["id"]),
    rate_naira: toNaira(row["rate_naira"]),
    card_type: String(row["card_type"]),
    min_value: toNaira(row["min_value"]),
    max_value: toNaira(row["max_value"]),
    region_id: String(row["r_id"]),
    gift_card_brands: {
      id: String(row["b_id"]),
      name: String(row["b_name"]),
      slug: String(row["b_slug"]),
      accent_color: (row["b_accent"] as string | null) ?? null,
      logo_url: (row["b_logo"] as string | null) ?? null,
    },
    gift_card_regions: {
      id: String(row["r_id"]),
      code: String(row["r_code"]),
      name: String(row["r_name"]),
      currency: String(row["r_currency"]),
      flag_emoji: (row["r_flag"] as string | null) ?? null,
    },
  };
}

/** Brands shown on the homepage and in the trade picker. */
export const listBrands = createServerFn({ method: "GET" }).handler(async (): Promise<BrandRow[]> => {
  const { query } = await import("./d1.server");
  const rows = await query<Record<string, unknown>>(
    `SELECT id, name, slug, accent_color, logo_url FROM gift_card_brands
      WHERE is_visible = 1 ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    name: String(r["name"]),
    slug: String(r["slug"]),
    accent_color: (r["accent_color"] as string | null) ?? null,
    logo_url: (r["logo_url"] as string | null) ?? null,
  }));
});

export const listRegions = createServerFn({ method: "GET" }).handler(async () => {
  const { query } = await import("./d1.server");
  const rows = await query<Record<string, unknown>>(
    `SELECT id, code, name, currency, flag_emoji FROM gift_card_regions
      WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    code: String(r["code"]),
    name: String(r["name"]),
    currency: String(r["currency"]),
    flag_emoji: (r["flag_emoji"] as string | null) ?? null,
  }));
});

/** The full rate table. */
export const listVariants = createServerFn({ method: "GET" }).handler(
  async (): Promise<VariantRow[]> => {
    const { query, toNaira } = await import("./d1.server");
    const rows = await query<Record<string, unknown>>(
      `${VARIANT_SELECT} WHERE v.is_active = 1 AND b.is_visible = 1
        ORDER BY v.rate_naira DESC, b.name ASC`,
    );
    return rows.map((r) => shapeVariant(r, toNaira));
  },
);

/** Highest physical-card rates, for the homepage strip. */
export const listTopRates = createServerFn({ method: "GET" }).handler(
  async (): Promise<VariantRow[]> => {
    const { query, toNaira } = await import("./d1.server");
    const rows = await query<Record<string, unknown>>(
      `${VARIANT_SELECT} WHERE v.is_active = 1 AND b.is_visible = 1 AND v.card_type = 'physical'
        ORDER BY v.rate_naira DESC LIMIT 12`,
    );
    return rows.map((r) => shapeVariant(r, toNaira));
  },
);

/** Variants for one brand, used by the trade form. */
export const listBrandVariants = createServerFn({ method: "GET" })
  .inputValidator((d: { brandId: string }) => z.object({ brandId: z.string().min(10) }).parse(d))
  .handler(async ({ data }): Promise<VariantRow[]> => {
    const { query, toNaira } = await import("./d1.server");
    const rows = await query<Record<string, unknown>>(
      `${VARIANT_SELECT} WHERE v.is_active = 1 AND v.brand_id = ?
        ORDER BY r.sort_order ASC, v.card_type ASC`,
      [data.brandId],
    );
    return rows.map((r) => shapeVariant(r, toNaira));
  });

export const listBanners = createServerFn({ method: "GET" }).handler(async () => {
  const { query } = await import("./d1.server");
  const now = new Date().toISOString();
  const rows = await query<Record<string, unknown>>(
    `SELECT id, title, subtitle, link, image_url FROM campaign_banners
      WHERE is_active = 1
        AND (starts_at IS NULL OR starts_at <= ?)
        AND (ends_at IS NULL OR ends_at >= ?)
      ORDER BY sort_order ASC`,
    [now, now],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    title: String(r["title"] ?? ""),
    subtitle: (r["subtitle"] as string | null) ?? null,
    link: (r["link"] as string | null) ?? null,
    image_url: (r["image_url"] as string | null) ?? null,
  }));
});

/** Banks for the withdrawal screen. */
export const listBanks = createServerFn({ method: "GET" }).handler(async () => {
  const { query } = await import("./d1.server");
  const rows = await query<Record<string, unknown>>(
    `SELECT id, name, code, is_digital FROM banks WHERE is_active = 1
      ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    name: String(r["name"]),
    code: (r["code"] as string | null) ?? null,
    is_digital: Boolean(r["is_digital"]),
  }));
});
