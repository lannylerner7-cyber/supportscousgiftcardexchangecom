import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ImagePlus, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { listBrands, listBrandVariants } from "@/lib/catalog.functions";
import { createTrade, findSubmission } from "@/lib/trade.functions";
import { uploadTradePhoto } from "@/lib/upload-client";
import { checkImage, imageType } from "@/lib/image-validation";
import { clearDraft, loadDraft, saveDraft, type SubmissionDraft } from "@/lib/submission-draft";
import { BrandLogo } from "@/components/BrandTile";
import { naira, currencySymbol } from "@/lib/format";
import { playTap } from "@/lib/sounds";
import { notifyTradeSubmitted } from "@/lib/alerts.functions";
import { cn } from "@/lib/utils";
import { useMarketRealtime } from "@/hooks/useMarketRealtime";
import {NativePhotoPicker} from "@/components/NativePhotoPicker";

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
  const { user } = Route.useRouteContext();
  const submitting = useRef(false);
  const draftRef = useRef<SubmissionDraft | null>(null);
  const [recovering, setRecovering] = useState(true);
  const [recoveryError, setRecoveryError] = useState("");
  const [progress, setProgress] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [step, setStep] = useState(0);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [cardType, setCardType] = useState<"physical" | "ecode" | null>(null);
  const [amount, setAmount] = useState("");
  const [ecode, setEcode] = useState("");
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submittedTrade, setSubmittedTrade] = useState<{ id: string } | null>(null);
  const uploadedFiles = useRef(new Set<File>());
  const [brandQuery, setBrandQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function recover() {
      try {
        const draft = loadDraft(user.id);
        draftRef.current = draft;
        if (draft) {
          const found = await findSubmission({ data: { submissionId: draft.submissionId } });
          if (found && !cancelled) setSubmittedTrade(found);
        }
      } catch (error) {
        if (!cancelled) setRecoveryError(error instanceof Error ? error.message : "Check your trade history before trying again.");
      } finally { if (!cancelled) setRecovering(false); }
    }
    void recover();
    return () => { cancelled = true; };
  }, [user.id]);

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
           const problem = checkImage(imageType(file.type, file.name), file.size);
           if (problem) throw new Error(problem);
        }
      }

      // Cross-tab locking ensures both tabs use the same durable random identity.
      const create = async () => {
        const draft = loadDraft(user.id) ?? { submissionId: crypto.randomUUID() };
        draftRef.current = draft;
        saveDraft(user.id, draft); // Fail before network writes if storage is unavailable.
        return createTrade({
        data: {
          submissionId: draft.submissionId,
          variantId: variant.id,
          faceValue: value,
          ...(cardType === "ecode" && ecode ? { ecode } : {}),
          ...(cardType === "ecode" && pin ? { ecodePin: pin } : {}),
          ...(note ? { note } : {}),
        },
        });
      };
      setUploadError("");
      setProgress("Saving submission — please wait…");
      const trade = submittedTrade ?? await (navigator.locks
        ? navigator.locks.request(`scous-trade:${user.id}`, create)
        : Promise.reject(new Error("This browser cannot safely coordinate submissions. Update your browser before submitting.")));
      if (!trade) throw new Error("Submission could not be confirmed. Retry the same submission.");
      setSubmittedTrade(trade);
      if (draftRef.current) saveDraft(user.id, { ...draftRef.current, tradeId: trade.id });

      // Photos go to our own private storage, one request each.
      for (const [index, file] of files.entries()) {
        if (uploadedFiles.current.has(file)) continue;
        setProgress(`Photo ${index + 1} of ${files.length}: uploading…`);
        try { await uploadTradePhoto(trade.id, file); }
        catch (error) { throw new Error(`Photo ${index + 1}: ${error instanceof Error ? error.message : "Upload failed. Retry this photo."}`); }
        uploadedFiles.current.add(file);
        setProgress(`Photo ${index + 1} of ${files.length}: saved.`);
      }

      // Tell the desk after everything is stored; a mail hiccup must not fail the trade.
      void notifyTradeSubmitted({ data: { tradeId: trade.id } }).catch(() => undefined);
      return trade;
    },
    onSuccess: (trade) => {
      toast.success("Card submitted — it is now pending review");
      void navigate({ to: "/app/history/$tradeId", params: { tradeId: trade.id } });
    },
    onError: (e: Error) => { setProgress("Stopped — check the message below before retrying."); setUploadError(e.message); toast.error(e.message); },
    onSettled: () => { submitting.current = false; },
  });

  function go(next: number) {
    if (submittedTrade || submit.isPending) return;
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

  if (recovering) return <p role="status">Checking for an unfinished submission…</p>;
  if (recoveryError) return <p role="alert">{recoveryError} <Link to="/app/history">Open history</Link></p>;
  if (submittedTrade && step !== 4) return <section className="space-y-4">
    <h1 className="font-display text-xl font-bold">Continue your saved submission</h1>
    <p>Your previous trade is saved. Open it to check or retry its photos without creating another trade.</p>
    <Link className="text-primary block" to="/app/history/$tradeId" params={{ tradeId: submittedTrade.id }}>Open trade / resume photos</Link>
    <button className="border-border rounded-full border px-4 py-2" onClick={() => {
      clearDraft(user.id); draftRef.current = null; setSubmittedTrade(null);
    }}>Start a separate card submission</button>
  </section>;

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
                    if (cardType !== t) {
                      setFiles([]);
                      uploadedFiles.current.clear();
                    }
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
            {submittedTrade && (
              <p role="status" className="text-muted-foreground text-sm">
                Your trade is saved. Retry remaining photos here, or resume from its history page after a reload.
                <Link className="text-primary block" to="/app/history/$tradeId" params={{ tradeId: submittedTrade.id }}>Open saved trade / resume photos</Link>
              </p>
            )}
            {cardType === "ecode" ? (
              <>
                <label className="block">
                  <span className="text-muted-foreground text-xs font-medium">Gift card code</span>
                  <input
                    disabled={Boolean(submittedTrade) || submit.isPending}
                    value={ecode}
                    onChange={(e) => setEcode(e.target.value)}
                    className="border-border bg-surface focus:border-primary mt-2 w-full rounded-2xl border px-4 py-3 font-mono text-sm outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground text-xs font-medium">PIN (optional)</span>
                  <input
                    disabled={Boolean(submittedTrade) || submit.isPending}
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
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                    disabled={Boolean(submittedTrade) || submit.isPending}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const next = [...files, ...Array.from(e.target.files ?? [])];
                      if (next.length > 5) { setUploadError("Choose at most five photos."); return; }
                      setUploadError(""); setFiles(next);
                    }}
                  />
                </label>
                {files.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {files.map((f, i) => (
                      <div key={i} className="relative">
                        <PhotoPreview file={f} index={i} />
                        <button
                          type="button"
                          disabled={Boolean(submittedTrade) || submit.isPending}
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
                <NativePhotoPicker disabled={Boolean(submittedTrade)||submit.isPending||files.length>=5}
                  onError={setUploadError} onPhoto={file=>{
                    const problem=checkImage(imageType(file.type,file.name),file.size);
                    if(problem){setUploadError(problem);return;}
                    setFiles(previous=>previous.length<5?[...previous,file]:previous);setUploadError("");
                  }}/>
              </>
            )}
            <label className="block">
              <span className="text-muted-foreground text-xs font-medium">Note (optional)</span>
              <textarea
                disabled={Boolean(submittedTrade) || submit.isPending}
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

      {progress && <p role="status" aria-live="polite">{progress}</p>}
      {uploadError && <p role="alert" className="text-destructive text-sm">{uploadError}</p>}
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
          onClick={() => { if (!submitting.current) { submitting.current = true; submit.mutate(); } }}
          className="bg-money-gradient text-background flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-40"
        >
          {submit.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {submit.isPending ? "Processing — please wait…" : uploadError ? "Retry this submission / remaining photos" : "Submit card for review"}
        </button>
      )}
    </div>
  );
}

function PhotoPreview({ file, index }: { file: File; index: number }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return <img src={url || undefined} alt={`Card proof ${index + 1}`} className="h-24 w-full rounded-xl object-cover" />;
}
