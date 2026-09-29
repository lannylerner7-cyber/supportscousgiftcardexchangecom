import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  adminListBrands,
  adminListVariants,
  adminSetBrandVisible,
  adminSetRate,
  adminSetVariantActive,
} from "@/lib/admin.people.functions";
import { BrandLogo } from "@/components/BrandTile";
import { cn } from "@/lib/utils";
import { useMarketRealtime } from "@/hooks/useMarketRealtime";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/rates")({
  component: AdminRates,
});

type Brand = {
  id: string;
  name: string;
  slug: string;
  accent_color: string | null;
  logo_url: string | null;
  is_visible: boolean;
};

function AdminRates() {
  useMarketRealtime();
  const qc = useQueryClient();
  const [brandId, setBrandId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const brands = useQuery({
    queryKey: ["admin-brands"],
    queryFn: () => adminListBrands(),
  });

  const active = brandId ?? brands.data?.[0]?.id ?? null;

  const variants = useQuery({
    queryKey: ["admin-variants", active],
    enabled: Boolean(active),
    queryFn: () => adminListVariants({ data: { brandId: active! } }),
  });

  const toggleBrand = useMutation({
    mutationFn: (b: Brand) =>
      adminSetBrandVisible({ data: { brandId: b.id, visible: !b.is_visible } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-brands"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveRate = useMutation({
    mutationFn: (args: { id: string; rate: number }) =>
      adminSetRate({ data: { variantId: args.id, rate: args.rate } }),
    onSuccess: () => {
      toast.success("Rate updated — the market page shows it instantly");
      void qc.invalidateQueries({ queryKey: ["admin-variants"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleVariant = useMutation({
    mutationFn: (args: { id: string; next: boolean }) =>
      adminSetVariantActive({ data: { variantId: args.id, active: args.next } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-variants"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <h1 className="font-display text-lg font-bold">Today's market & rates</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(brands.data ?? []).map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBrandId(b.id)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold whitespace-nowrap",
              active === b.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            <BrandLogo brand={b} className="h-4 w-4" />
            {b.name}
          </button>
        ))}
      </div>

      {(brands.data ?? [])
        .filter((b) => b.id === active)
        .map((b) => (
          <div
            key={b.id}
            className="border-border/70 bg-surface flex items-center justify-between rounded-2xl border p-4"
          >
            <span className="text-sm font-semibold">Show {b.name} on the market</span>
            <button
              type="button"
              onClick={() => toggleBrand.mutate(b)}
              className={cn(
                "h-6 w-11 rounded-full transition-colors",
                b.is_visible ? "bg-money" : "bg-muted-foreground/40",
              )}
              aria-label="Toggle market visibility"
            >
              <span
                className={cn(
                  "bg-background block h-5 w-5 rounded-full transition-transform",
                  b.is_visible ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
        ))}

      <div className="space-y-2">
        {(variants.data ?? []).map((v) => {
          const r = v.region;
          const key = v.id;
          return (
            <div
              key={v.id}
              className="border-border/70 bg-surface flex flex-wrap items-center gap-3 rounded-2xl border p-4"
            >
              <span className="text-sm">
                {r?.flag_emoji} {r?.code} · {v.card_type === "ecode" ? "E-code" : "Physical"} ·{" "}
                {v.min_value}–{v.max_value} {r?.currency}
              </span>
              <input
                inputMode="decimal"
                value={draft[key] ?? String(v.rate_naira)}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.replace(/[^\d.]/g, "") }))}
                className="border-border bg-surface-2 ml-auto w-28 rounded-xl border px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => saveRate.mutate({ id: v.id, rate: Number(draft[key] ?? v.rate_naira) })}
                className="bg-gold-gradient text-primary-foreground rounded-full px-4 py-2 text-xs font-bold"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => toggleVariant.mutate({ id: v.id, next: !v.is_active })}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs font-semibold",
                  v.is_active ? "border-money/50 text-money" : "border-border text-muted-foreground",
                )}
              >
                {v.is_active ? "Live" : "Off"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
