import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, ImagePlus, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { listBrands, listBrandVariants } from "@/lib/catalog.functions";
import { createTrade } from "@/lib/trade.functions";
import { BrandLogo } from "@/components/BrandTile";
import { naira, currencySymbol } from "@/lib/format";
import { playTap } from "@/lib/sounds";
import { notifyTradeSubmitted } from "@/lib/alerts.functions";
import { cn } from "@/lib/utils";
import { useMarketRealtime } from "@/hooks/useMarketRealtime";

const MAX_FACE_VALUE = 5000;

export const Route = createFileRoute("/_authenticated/app/trade")({
  component: TradePage,
});

type Brand = {
  id: string;
  name: string;
  slug: string;
  accent_color: string | null;
  logo_url: string | null;
};

type Variant = {
  id: string;
  card_type: "physical" | "ecode";
  min_value: number;
  max_value: number;
  rate_naira: number;
  region_id: string;
  gift_card_regions: {
    id: string;
    code: string;
    name: string;
    currency: string;
    flag_emoji: string | null;
  } | null;
};

const STEPS = ["Card", "Region", "Type", "Amount", "Proof"] as const;

function TradePage() {
  useMarketRealtime();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [cardType, setCardType] = useState<"physical" | "ecode" | null>(null);
  const [amount, setAmount] = useState("");
  const [ecode, setEcode] = useState("");
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [brandQuery, setBrandQuery] = useState("");

  const brands = useQuery({
    queryKey: ["market-brands"],
    queryFn: () => listBrands() as unknown as Promise<Brand[]>,
  });

  const variants = useQuery({
    queryKey: ["market-variants", brand?.id],
    enabled: Boolean(brand?.id),
    queryFn: () => {
      if (!brand) return Promise.resolve([]);
      return listBrandVariants({ data: { brandId: brand.id } }) as unknown as Promise<Variant[]>;
    },
  });

  const rows = variants.data ?? [];
  const filteredBrands = (brands.data ?? []).filter((item) =>
    item.name.toLowerCase().includes(brandQuery.trim().toLowerCase()),
  );

  const regions = useMemo(() => {
    const map = new Map<string, NonNullable<Variant["gift_card_regions"]>>();
    for (const v of rows) if (v.gift_card_regions) map.set(v.region_id, v.gift_card_regions);
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [rows]);

  const typesForRegion = useMemo(
    () => rows.filter((v) => v.region_id === regionId),
    [rows, regionId],
  );

  const variant = useMemo(
    () => typesForRegion.find((v) => v.card_type === cardType) ?? null,
    [typesForRegion, cardType],
  );

  const region = regions.find((r) => r.id === regionId) ?? null;
  const value = Number(amount || 0);
  const payout = variant ? value * Number(variant.rate_naira) : 0;

  const submit = useMutation({
    mutationFn: async () => {
      if (!variant) throw new Error("Pick a card first");
      if (value > MAX_FACE_VALUE)
        throw new Error("Cards above 5,000 must be arranged with support");
      if (cardType === "physical") {
        if (files.length < 1 || files.length > 5)
          throw new Error("Add between 1 and 5 photos of the card");
        for (const file of files) {
          if (!file.type.startsWith("image/")) throw new Error("Only image files are allowed");
          if (file.size > 10 * 1024 * 1024) throw new Error("Each photo must be under 10MB");
        }
      }

      const trade = await createTrade({
        data: {
          variantId: variant.id,
          faceValue: value,
          ...(cardType === "ecode" && ecode ? { ecode } : {}),
          ...(cardType === "ecode" && pin ? { ecodePin: pin } : {}),
          ...(note ? { note } : {}),
        },
      });

      // Photos go to our own private storage, one request each.
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        body.append("tradeId", trade.id);
        const res = await fetch("/api/uploads", { method: "POST", body });
        if (!res.ok) {
          const contentType = res.headers.get("content-type") ?? "";
          const responseBody = await res.text();
          const message = contentType.includes("text/html")
            ? "Your card was submitted, but its photo did not upload. Please contact support before submitting it again."
            : responseBody.trim() || "The card photo could not be uploaded. Please try again.";
          throw new Error(message);
        }
      }

      // Tell the desk after everything is stored; a mail hiccup must not fail the trade.
      void notifyTradeSubmitted({ data: { tradeId: trade.id } }).catch(() => undefined);
      return trade;
    },
    onSuccess: (trade) => {
      toast.success("Card submitted — it is now pending review");
      void navigate({ to: "/app/history/$tradeId", params: { tradeId: trade.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function go(next: number) {
    playTap();
    setStep(next);
  }

  const canContinue = [
    Boolean(brand),
    Boolean(regionId),
    Boolean(cardType),
    Boolean(
      variant && value >= Number(variant.min_value) && value <= Number(variant.max_value),
    ),
    cardType === "ecode" ? ecode.trim().length > 3 : files.length > 0,
  ][step];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => go(step - 1)}
            className="border-border bg-surface rounded-full border p-2"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div>
          <h1 className="font-display text-xl font-bold">Trade a card</h1>
          <p className="text-muted-foreground text-xs">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>
        </div>
      </div>

      <div className="bg-surface-2 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-gold-gradient h-full rounded-full transition-all duration-500"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      <div key={step} className="animate-[pop-in_.35s_ease-out]">
        {step === 0 && (
          <div className="space-y-4">
            <label className="border-border bg-surface focus-within:border-primary flex items-center gap-3 rounded-full border px-4 py-3">
              <Search className="text-muted-foreground h-4 w-4 shrink-0" />
              <input
                value={brandQuery}
                onChange={(event) => setBrandQuery(event.target.value)}
                placeholder="Search gift cards"
                className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {brands.isLoading &&
                Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="bg-surface-2 shimmer h-24 rounded-2xl" />
                ))}
              {filteredBrands.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setBrand(b);
                    setRegionId(null);
                    setCardType(null);
                    go(1);
                  }}
                  className={cn(
                    "border-border/70 bg-surface hover:bg-surface-2 tilt-tap flex flex-col items-center gap-2 rounded-2xl border p-3 transition-all",
                    brand?.id === b.id && "border-primary",
                  )}
                >
                  <BrandLogo brand={b} className="h-10 w-10" />
                  <span className="text-center text-[11px] font-semibold">{b.name}</span>
                </button>
              ))}
            </div>
            {!brands.isLoading && filteredBrands.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">No gift card matches that search.</p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-2 gap-3">
            {variants.isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-surface-2 shimmer h-16 rounded-2xl" />
              ))}
            {regions.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setRegionId(r.id);
                  setCardType(null);
                  go(2);
                }}
                className={cn(
                  "border-border/70 bg-surface hover:bg-surface-2 flex items-center gap-3 rounded-2xl border p-4 text-left",
                  regionId === r.id && "border-primary",
                )}
              >
                <span className="text-2xl">{r.flag_emoji ?? "🌍"}</span>
                <span>
                  <span className="block text-sm font-semibold">{r.name}</span>
                  <span className="text-muted-foreground text-xs">{r.currency}</span>
                </span>
              </button>
            ))}
            {!variants.isLoading && regions.length === 0 && (
              <p className="text-muted-foreground text-sm">No regions priced for this card yet.</p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {(["physical", "ecode"] as const).map((t) => {
              const v = typesForRegion.find((x) => x.card_type === t);
              if (!v) return null;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setCardType(t);
                    go(3);
                  }}
                  className={cn(
                    "border-border/70 bg-surface hover:bg-surface-2 flex w-full items-center justify-between rounded-2xl border p-4 text-left",
                    cardType === t && "border-primary",
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      {t === "physical" ? "Physical card" : "E-code"}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t === "physical"
                        ? "You have the card / receipt photo"
                        : "You have the code and PIN"}
                    </span>
                  </span>
                  <span className="text-money text-sm font-bold">
                    ₦{Number(v.rate_naira).toLocaleString()} / {region?.currency ?? "$"}1
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {step === 3 && variant && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-muted-foreground text-xs font-medium">
                Card value ({currencySymbol(region?.currency ?? "USD")})
              </span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder={`${variant.min_value} – ${variant.max_value}`}
                className="border-border bg-surface focus:border-primary font-display mt-2 w-full rounded-2xl border px-4 py-4 text-2xl font-bold outline-none"
              />
            </label>
            <div className="border-border/70 bg-night-gradient rounded-2xl border p-5">
              <p className="text-muted-foreground text-xs">You will receive</p>
              <p className="font-display text-money mt-1 text-3xl font-extrabold">
                {naira(payout)}
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Rate ₦{Number(variant.rate_naira).toLocaleString()} per{" "}
                {currencySymbol(region?.currency ?? "USD")}1 · accepted range{" "}
                {variant.min_value}–{variant.max_value}
              </p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            {cardType === "ecode" ? (
              <>
                <label className="block">
                  <span className="text-muted-foreground text-xs font-medium">Gift card code</span>
                  <input
                    value={ecode}
                    onChange={(e) => setEcode(e.target.value)}
                    className="border-border bg-surface focus:border-primary mt-2 w-full rounded-2xl border px-4 py-3 font-mono text-sm outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground text-xs font-medium">PIN (optional)</span>
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="border-border bg-surface focus:border-primary mt-2 w-full rounded-2xl border px-4 py-3 font-mono text-sm outline-none"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="border-border bg-surface hover:bg-surface-2 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
                  <ImagePlus className="text-primary h-7 w-7" />
                  <span className="text-sm font-semibold">Upload card & receipt photos</span>
                  <span className="text-muted-foreground text-xs">Up to 5 clear images</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) =>
                      setFiles((prev) =>
                        [...prev, ...Array.from(e.target.files ?? [])].slice(0, 5),
                      )
                    }
                  />
                </label>
                {files.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {files.map((f, i) => (
                      <div key={i} className="relative">
                        <img
                          src={URL.createObjectURL(f)}
                          alt={`Card proof ${i + 1}`}
                          className="h-24 w-full rounded-xl object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => setFiles((p) => p.filter((_, x) => x !== i))}
                          className="bg-background/80 absolute top-1 right-1 rounded-full p-1"
                          aria-label="Remove image"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <label className="block">
              <span className="text-muted-foreground text-xs font-medium">Note (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="border-border bg-surface focus:border-primary mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
              />
            </label>
            <div className="border-border/70 bg-surface flex items-center justify-between rounded-2xl border p-4">
              <span className="text-xs">
                {brand?.name} · {region?.code} · {cardType === "ecode" ? "E-code" : "Physical"} ·{" "}
                {currencySymbol(region?.currency ?? "USD")}
                {value}
              </span>
              <span className="text-money font-display text-lg font-bold">{naira(payout)}</span>
            </div>
          </div>
        )}
      </div>

      {step < STEPS.length - 1 ? (
        <button
          type="button"
          disabled={!canContinue}
          onClick={() => go(step + 1)}
          className="bg-gold-gradient text-primary-foreground w-full rounded-full py-3.5 text-sm font-bold disabled:opacity-40"
        >
          Continue
        </button>
      ) : (
        <button
          type="button"
          disabled={!canContinue || submit.isPending}
          onClick={() => submit.mutate()}
          className="bg-money-gradient text-background flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-40"
        >
          {submit.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Submit card for review
        </button>
      )}
    </div>
  );
}
