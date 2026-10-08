import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { adminListTrades } from "@/lib/admin.functions";
import { naira, shortDate, TRADE_STATUS_LABEL } from "@/lib/format";
import { playAlert } from "@/lib/sounds";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/trades")({
  component: AdminTrades,
});

const FILTERS = ["pending", "successful", "partially_paid", "error", "all"] as const;

function AdminTrades() {
  const qc = useQueryClient();
  const matches = useMatches();
  const isDetail = matches.some((m) => m.routeId.endsWith("/admin/trades/$id"));
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
  const seen = useRef<number | null>(null);

  const trades = useQuery({
    queryKey: ["admin-trades", filter],
    refetchInterval: 15000,
    queryFn: () => adminListTrades({ data: { status: filter } }),
  });

  const pendingCount = (trades.data ?? []).filter((t) => t.status === "pending").length;

  useEffect(() => {
    if (filter !== "pending") return;
    if (seen.current !== null && pendingCount > seen.current) playAlert();
    seen.current = pendingCount;
  }, [pendingCount, filter]);


  if (isDetail) return <Outlet />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-bold">Trade queue</h1>
        {pendingCount > 0 && (
          <span className="bg-warning/20 text-warning animate-pulse rounded-full px-3 py-1 text-xs font-bold">
            {pendingCount} unattended
          </span>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold whitespace-nowrap capitalize",
              filter === f
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {f === "all" ? "All" : (TRADE_STATUS_LABEL[f] ?? f)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {(trades.data ?? []).map((t) => (
          <Link
            key={t.id}
            to="/ScousGiftCardExchange/admin/trades/$id"
            params={{ id: t.id }}
            className="border-border/70 bg-surface hover:bg-surface-2 flex items-center justify-between rounded-2xl border p-4"
          >
            <div>
              <p className="text-sm font-semibold">
                {t.brand_name} · {t.region_code} · {t.currency} {t.face_value}
                {t.flagged_duplicate && (
                  <span className="text-destructive ml-2 text-[10px] font-bold">DUPLICATE?</span>
                )}
              </p>
              <p className="text-muted-foreground text-xs">
                {t.card_type === "ecode" ? "E-code" : "Physical"} · {shortDate(t.created_at)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-money text-sm font-bold">{naira(t.expected_payout)}</p>
              <p className="text-muted-foreground text-[10px]">
                {TRADE_STATUS_LABEL[t.status] ?? t.status}
              </p>
            </div>
          </Link>
        ))}
        {!trades.isLoading && (trades.data ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">Nothing in this view.</p>
        )}
      </div>
    </div>
  );
}
