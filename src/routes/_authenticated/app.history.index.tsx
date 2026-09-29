import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { listMyTrades } from "@/lib/trade.functions";
import { naira, shortDate, TRADE_STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/history/")({
  component: History,
});

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "successful", label: "Completed" },
  { key: "error", label: "Declined" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  successful: "bg-money/15 text-money",
  partially_paid: "bg-primary/15 text-primary",
  used: "bg-destructive/15 text-destructive",
  error: "bg-destructive/15 text-destructive",
};

function History() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const trades = useQuery({
    queryKey: ["my-trades"],
    queryFn: () => listMyTrades({ data: {} }),
  });

  const list = (trades.data ?? []).filter((t) => {
    if (filter === "all") return true;
    if (filter === "successful") return t.status === "successful" || t.status === "partially_paid";
    if (filter === "error") return t.status === "error" || t.status === "used";
    return t.status === filter;
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold">Trade history</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold whitespace-nowrap",
              filter === f.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {trades.isLoading &&
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface-2 shimmer h-[74px] rounded-2xl" />
        ))}

      {!trades.isLoading && list.length === 0 && (
        <div className="border-border/70 bg-surface rounded-2xl border p-10 text-center">
          <p className="text-sm font-semibold">Nothing here yet</p>
          <Link
            to="/app/trade"
            className="bg-gold-gradient text-primary-foreground mt-4 inline-flex rounded-full px-5 py-2.5 text-sm font-bold"
          >
            Trade a card
          </Link>
        </div>
      )}

      <div className="space-y-2">
        {list.map((t) => (
          <Link
            key={t.id}
            to="/app/history/$tradeId"
            params={{ tradeId: t.id }}
            className="border-border/70 bg-surface hover:bg-surface-2 flex items-center justify-between rounded-2xl border p-4"
          >
            <div>
              <p className="text-sm font-semibold">
                {t.brand_name} · {t.region_code}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t.currency} {t.face_value} · {t.card_type === "ecode" ? "E-code" : "Physical"} ·{" "}
                {shortDate(t.created_at)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-money text-sm font-bold">
                {naira(Number(t.paid_amount) > 0 ? t.paid_amount : t.expected_payout)}
              </p>
              <span
                className={cn(
                  "mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  STATUS_STYLE[t.status],
                )}
              >
                {TRADE_STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
