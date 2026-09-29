import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { adminStats, adminListTrades } from "@/lib/admin.functions";
import { naira, shortDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/")({
  component: Overview,
});

type Stats = {
  member_balance: number;
  held: number;
  redeemed_value: number;
  paid_out: number;
  fees: number;
  pending_trades: number;
  pending_withdrawals: number;
  members: number;
  trades_today: number;
  trades_week: number;
  unread_messages: number;
};

function Overview() {
  const stats = useQuery({
    queryKey: ["admin-stats"],
    refetchInterval: 20000,
    queryFn: () => adminStats(),
  });

  const recent = useQuery({
    queryKey: ["admin-recent-trades"],
    refetchInterval: 20000,
    queryFn: () => adminListTrades({ data: { limit: 8 } }),
  });

  const s = stats.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Members' balance (liability)" value={naira(s?.member_balance ?? 0)} accent />
        <Stat label="Card value redeemed" value={naira(s?.redeemed_value ?? 0)} />
        <Stat label="Paid out to banks" value={naira(s?.paid_out ?? 0)} />
        <Stat label="Fee income" value={naira(s?.fees ?? 0)} accent />
        <Stat label="Members" value={String(s?.members ?? 0)} />
        <Stat label="Trades this week" value={String(s?.trades_week ?? 0)} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Link
          to="/ScousGiftCardExchange/admin/messages"
          className="border-border/70 bg-surface rounded-2xl border p-5"
        >
          <p className="font-display text-2xl font-bold">{s?.unread_messages ?? 0}</p>
          <p className="text-muted-foreground text-xs">New messages</p>
        </Link>
        <Link
          to="/ScousGiftCardExchange/admin/trades"
          className="border-warning/40 bg-warning/10 rounded-2xl border p-5"
        >
          <p className="font-display text-2xl font-bold">{s?.pending_trades ?? 0}</p>
          <p className="text-muted-foreground text-xs">Cards waiting for review</p>
        </Link>
        <Link
          to="/ScousGiftCardExchange/admin/withdrawals"
          className="border-primary/40 bg-primary/10 rounded-2xl border p-5"
        >
          <p className="font-display text-2xl font-bold">{s?.pending_withdrawals ?? 0}</p>
          <p className="text-muted-foreground text-xs">Withdrawals to process</p>
        </Link>
      </div>

      <section className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Latest submissions</p>
        {(recent.data ?? []).map((t) => (
          <Link
            key={t.id}
            to="/ScousGiftCardExchange/admin/trades/$id"
            params={{ id: t.id }}
            className="border-border/70 bg-surface hover:bg-surface-2 flex items-center justify-between rounded-2xl border p-4"
          >
            <span className="text-sm">
              {t.brand_name} · {t.region_code} · {t.currency} {t.face_value}
            </span>
            <span className="text-muted-foreground text-xs">
              {t.status} · {shortDate(t.created_at)}
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border-border/70 bg-surface rounded-2xl border p-4">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p
        className={
          accent
            ? "font-display text-money mt-1 text-xl font-extrabold"
            : "font-display mt-1 text-xl font-extrabold"
        }
      >
        {value}
      </p>
    </div>
  );
}
