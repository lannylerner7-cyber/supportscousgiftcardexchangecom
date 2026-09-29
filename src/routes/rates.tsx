import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PublicFooter, PublicHeader } from "@/components/PublicHeader";
import { listVariants, type VariantRow } from "@/lib/catalog.functions";
import { naira } from "@/lib/format";
import { BrandLogo } from "@/components/BrandTile";
import { useMarketRealtime } from "@/hooks/useMarketRealtime";

export const Route = createFileRoute("/rates")({
  head: () => ({
    meta: [
      { title: "Today's gift card rates — ScousGiftCardExchange" },
      {
        name: "description",
        content:
          "Live Naira rates for Apple, Amazon, Steam, Razer Gold and more, by region and card type.",
      },
      { property: "og:title", content: "Today's gift card rates" },
      { property: "og:description", content: "Live Naira rates by brand, region and card type." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Rates,
});

type Row = VariantRow;

function Rates() {
  useMarketRealtime();
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["rates-table"],
    queryFn: () => listVariants(),
  });

  const rows = (data ?? []).filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      r.gift_card_brands?.name.toLowerCase().includes(q) ||
      r.gift_card_regions?.name.toLowerCase().includes(q) ||
      r.gift_card_regions?.code.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Today&apos;s rates</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Rates are per unit of the card&apos;s own currency and are set by our desk. Your exact
          payout is shown before you submit a trade.
        </p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brand or country"
          className="border-border bg-surface placeholder:text-muted-foreground focus:border-primary mt-6 w-full rounded-full border px-5 py-3 text-sm outline-none"
        />

        <div className="border-border/70 mt-6 max-h-[70vh] overflow-auto overscroll-contain rounded-2xl border">
          <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-muted-foreground text-xs uppercase">
              <tr>
                <th className="bg-surface-2 border-border/60 sticky top-0 left-0 z-30 border-b px-4 py-3">
                  Brand
                </th>
                <th className="bg-surface-2 border-border/60 sticky top-0 z-20 border-b px-4 py-3">
                  Region
                </th>
                <th className="bg-surface-2 border-border/60 sticky top-0 z-20 border-b px-4 py-3">
                  Type
                </th>
                <th className="bg-surface-2 border-border/60 sticky top-0 z-20 border-b px-4 py-3 text-right">
                  Rate
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-border/60 border-t">
                    <td colSpan={4} className="px-4 py-3">
                      <div className="bg-surface-2 shimmer h-4 w-full rounded" />
                    </td>
                  </tr>
                ))}
              {rows.map((r) => (
                <tr key={r.id} className="group">
                  <td className="bg-background group-hover:bg-surface border-border/60 sticky left-0 z-10 border-b px-4 py-3 font-semibold">
                    <span className="flex items-center gap-2">
                      {r.gift_card_brands && (
                        <BrandLogo brand={r.gift_card_brands} className="h-7 w-7 shrink-0" />
                      )}
                      {r.gift_card_brands?.name}
                    </span>
                  </td>
                  <td className="text-muted-foreground border-border/60 group-hover:bg-surface border-b px-4 py-3 whitespace-nowrap">
                    {r.gift_card_regions?.name} ({r.gift_card_regions?.code})
                  </td>
                  <td className="text-muted-foreground border-border/60 group-hover:bg-surface border-b px-4 py-3 whitespace-nowrap">
                    {r.card_type === "physical" ? "Physical" : "E-code"}
                  </td>
                  <td className="text-money border-border/60 group-hover:bg-surface border-b px-4 py-3 text-right font-bold whitespace-nowrap">
                    {naira(r.rate_naira)}
                  </td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted-foreground px-4 py-10 text-center">
                    Nothing matches that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
