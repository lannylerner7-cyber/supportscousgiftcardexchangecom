import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, PartyPopper } from "lucide-react";

import { getMyTrade } from "@/lib/trade.functions";
import { Confetti } from "@/components/Confetti";
import { naira, shortDate, TRADE_STATUS_LABEL } from "@/lib/format";
import { playChime } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import { ResumeTradeUploads } from "@/components/ResumeTradeUploads";

export const Route = createFileRoute("/_authenticated/app/history/$tradeId")({
  component: TradeDetail,
});

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  successful: "bg-money/15 text-money",
  partially_paid: "bg-primary/15 text-primary",
  used: "bg-destructive/15 text-destructive",
  error: "bg-destructive/15 text-destructive",
};

function TradeDetail() {
  const { tradeId } = useParams({ from: "/_authenticated/app/history/$tradeId" });
  const [celebrate, setCelebrate] = useState(false);

  const trade = useQuery({
    queryKey: ["trade", tradeId],
    refetchInterval: 15000,
    queryFn: () => getMyTrade({ data: { tradeId } }),
  });

  const t = trade.data;
  const paid = Number(t?.paid_amount ?? 0);
  const redeemed = t?.status === "successful" || t?.status === "partially_paid";

  useEffect(() => {
    if (redeemed && !celebrate) {
      setCelebrate(true);
      playChime();
    }
  }, [redeemed, celebrate]);

  if (trade.isLoading) return <div className="bg-surface-2 shimmer h-64 rounded-3xl" />;
  if (!t) return <p className="text-muted-foreground text-sm">Trade not found.</p>;

  return (
    <div className="space-y-5">
      <Confetti fire={celebrate} />

      <Link to="/app/history" className="text-muted-foreground flex items-center gap-2 text-sm">
        <ArrowLeft className="h-4 w-4" /> Back to history
      </Link>

      {redeemed && (
        <div className="border-money/40 bg-money/10 rounded-3xl border p-5 text-center">
          <PartyPopper className="text-money mx-auto h-8 w-8" />
          <p className="font-display mt-2 text-lg font-bold">
            Your gift card has been redeemed successfully
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {naira(paid)} was added to your wallet.
          </p>
          <Link
            to="/app"
            className="bg-money-gradient text-background mt-4 inline-flex rounded-full px-6 py-2.5 text-sm font-bold"
          >
            Check your balance now
          </Link>
        </div>
      )}

      <section className="border-border/70 bg-night-gradient rounded-3xl border p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-display text-lg font-bold">
              {t.brand_name} · {t.region_code}
            </p>
            <p className="text-muted-foreground text-xs">
              {t.currency} {t.face_value} · {t.card_type === "ecode" ? "E-code" : "Physical"}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-semibold",
              STATUS_STYLE[t.status],
            )}
          >
            {TRADE_STATUS_LABEL[t.status] ?? t.status}
          </span>
        </div>
        <p className="font-display text-money mt-4 text-3xl font-extrabold">
          {naira(paid > 0 ? paid : t.expected_payout)}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Rate ₦{Number(t.rate_at_submit).toLocaleString()} · submitted {shortDate(t.created_at)}
        </p>
      </section>

      {t.admin_note && (
        <section className="border-border/70 bg-surface rounded-2xl border p-4">
          <p className="text-muted-foreground text-xs font-semibold uppercase">Note from us</p>
          <p className="mt-1 text-sm">{t.admin_note}</p>
        </section>
      )}

      <section className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Timeline</p>
        <Step label="Card submitted" done at={t.created_at} />
        <Step label="Under review" done={t.status !== "pending"} at={t.reviewed_at} />
        <Step
          label={redeemed ? "Wallet credited" : "Decision"}
          done={t.status !== "pending"}
          at={t.reviewed_at}
        />
      </section>

      {t.status === "pending" && t.card_type === "physical" && (
        <ResumeTradeUploads tradeId={tradeId} pending={t.pendingUploads} onSaved={() => { void trade.refetch(); }} />
      )}
      {(trade.data?.images ?? []).length > 0 && (
        <section>
          <p className="text-muted-foreground text-xs font-semibold uppercase">Your uploads</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(trade.data?.images ?? []).map((img, i) => (
              <img
                key={img.id}
                src={`/api/files/${img.path}`}
                alt={`Card proof ${i + 1}`}
                loading="lazy"
                className="h-24 w-full rounded-xl object-cover"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Step({
  label,
  done,
  at,
}: {
  label: string;
  done?: boolean;
  at?: string | null;
}) {
  return (
    <div className="border-border/70 bg-surface flex items-center justify-between rounded-2xl border p-3">
      <span className="flex items-center gap-3 text-sm">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            done ? "bg-money" : "bg-muted-foreground/40",
          )}
        />
        {label}
      </span>
      <span className="text-muted-foreground text-xs">{at ? shortDate(at) : "—"}</span>
    </div>
  );
}
