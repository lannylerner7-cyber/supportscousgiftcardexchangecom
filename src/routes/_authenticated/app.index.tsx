import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Eye, EyeOff, ArrowUpRight, Repeat, ArrowRight } from "lucide-react";

import { getWallet } from "@/lib/wallet.functions";
import { listMyTrades } from "@/lib/trade.functions";
import { CountUpNaira } from "@/components/CountUp";
import { naira, shortDate, TRADE_STATUS_LABEL } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/")({
  component: Dashboard,
});

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  successful: "bg-money/15 text-money",
  partially_paid: "bg-primary/15 text-primary",
  used: "bg-destructive/15 text-destructive",
  error: "bg-destructive/15 text-destructive",
};

function Dashboard() {
  const [hidden, setHidden] = useState(false);

  const wallet = useQuery({
    queryKey: ["my-wallet"],
    queryFn: () => getWallet(),
  });

  const trades = useQuery({
    queryKey: ["my-recent-trades"],
    queryFn: () => listMyTrades({ data: { limit: 5 } }),
  });

  const balance = Number(wallet.data?.balance_naira ?? 0);

  return (
    <div className="space-y-6">
      <section className="bg-night-gradient border-border/70 relative overflow-hidden rounded-3xl border p-6">
        <span
          className="pointer-events-none absolute -top-12 -right-8 h-36 w-36 rounded-full opacity-25 blur-3xl"
          style={{ background: "var(--money)" }}
        />
        <div className="relative flex items-center justify-between">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Wallet balance
          </p>
          <button
            type="button"
            onClick={() => setHidden((v) => !v)}
            aria-label={hidden ? "Show balance" : "Hide balance"}
            className="text-muted-foreground hover:text-foreground"
          >
            {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {wallet.isLoading ? (
          <div className="bg-surface-2 shimmer mt-3 h-10 w-48 rounded-lg" />
        ) : (
          <p className="font-display mt-2 text-4xl font-extrabold tracking-tight">
            {hidden ? "₦ ••••••" : <CountUpNaira value={balance} />}
          </p>
        )}

        {Number(wallet.data?.locked_naira ?? 0) > 0 && !hidden && (
          <p className="text-warning mt-2 text-xs">
            {naira(wallet.data?.locked_naira)} bonus locked until your first card is redeemed
          </p>
        )}
        {Number(wallet.data?.held_naira ?? 0) > 0 && !hidden && (
          <p className="text-muted-foreground mt-1 text-xs">
            {naira(wallet.data?.held_naira)} held for a pending withdrawal
          </p>
        )}

        <div className="relative mt-6 grid grid-cols-2 gap-3">
          <Link
            to="/app/trade"
            className="bg-gold-gradient text-primary-foreground flex items-center justify-center gap-2 rounded-full py-3 text-sm font-bold"
          >
            <Repeat className="h-4 w-4" /> Trade a card
          </Link>
          <Link
            to="/app/withdraw"
            className="border-border bg-surface hover:bg-surface-2 flex items-center justify-center gap-2 rounded-full border py-3 text-sm font-semibold"
          >
            <ArrowUpRight className="h-4 w-4" /> Withdraw
          </Link>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Recent trades</h2>
          <Link to="/app/history" className="text-primary flex items-center gap-1 text-sm font-semibold">
            See all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-3 space-y-2">
          {trades.isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-surface-2 shimmer h-[70px] rounded-2xl" />
            ))}

          {!trades.isLoading && (trades.data ?? []).length === 0 && (
            <div className="border-border/70 bg-surface rounded-2xl border p-8 text-center">
              <p className="text-sm font-semibold">No trades yet</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Pick a card brand and we&apos;ll price it for you.
              </p>
              <Link
                to="/app/trade"
                className="bg-gold-gradient text-primary-foreground mt-4 inline-flex rounded-full px-5 py-2.5 text-sm font-bold"
              >
                Start your first trade
              </Link>
            </div>
          )}

          {(trades.data ?? []).map((t) => (
            <Link
              key={t.id}
              to="/app/history/$tradeId"
              params={{ tradeId: t.id }}
              className="border-border/70 bg-surface hover:bg-surface-2 flex items-center justify-between rounded-2xl border p-4 transition-colors"
            >
              <div>
                <p className="text-sm font-semibold">
                  {t.brand_name} · {t.region_code}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t.currency} {t.face_value} · {shortDate(t.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-money text-sm font-bold">{naira(t.expected_payout)}</p>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[t.status] ?? ""}`}
                >
                  {TRADE_STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
