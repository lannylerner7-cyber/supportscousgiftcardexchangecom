import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { adminGetTrade, adminReviewTrade } from "@/lib/admin.functions";
import { naira, shortDate, TRADE_STATUS_LABEL } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/trades/$id")({
  component: AdminTradeDetail,
});

function AdminTradeDetail() {
  const { id } = useParams({ from: "/_authenticated/ScousGiftCardExchange/admin/trades/$id" });
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [partial, setPartial] = useState("");

  const trade = useQuery({
    queryKey: ["admin-trade", id],
    queryFn: () => adminGetTrade({ data: { tradeId: id } }),
  });

  const member = { data: trade.data?.member ?? null };
  const images = {
    data: (trade.data?.images ?? []).map((i) => `/api/files/${i.path}`),
  };

  const review = useMutation({
    mutationFn: (status: "successful" | "partially_paid" | "used" | "error") =>
      adminReviewTrade({
        data: {
          tradeId: id,
          status,
          ...(status === "partially_paid" ? { paid: Number(partial || 0) } : {}),
          ...(note ? { note } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Decision saved and the member has been notified");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const t = trade.data;
  if (trade.isLoading) return <div className="bg-surface-2 shimmer h-72 rounded-3xl" />;
  if (!t) return <p className="text-muted-foreground text-sm">Trade not found.</p>;

  const pending = t.status === "pending";

  return (
    <div className="space-y-5">
      <Link
        to="/ScousGiftCardExchange/admin/trades"
        className="text-muted-foreground flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" /> Back to queue
      </Link>

      <section className="border-border/70 bg-night-gradient rounded-3xl border p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-display text-lg font-bold">
              {t.brand_name} · {t.region_code}
            </p>
            <p className="text-muted-foreground text-xs">
              {t.currency} {t.face_value} · {t.card_type === "ecode" ? "E-code" : "Physical"} ·{" "}
              {shortDate(t.created_at)}
            </p>
          </div>
          <span className="bg-surface-2 rounded-full px-3 py-1 text-[11px] font-semibold">
            {TRADE_STATUS_LABEL[t.status] ?? t.status}
          </span>
        </div>
        <p className="font-display text-money mt-4 text-3xl font-extrabold">
          {naira(t.expected_payout)}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Rate ₦{Number(t.rate_at_submit).toLocaleString()} at submission
        </p>
        {t.flagged_duplicate && (
          <p className="text-destructive mt-2 text-xs font-semibold">
            This code was submitted before — check carefully.
          </p>
        )}
      </section>

      <section className="border-border/70 bg-surface rounded-2xl border p-4">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Member</p>
        <p className="mt-1 text-sm font-semibold">{member.data?.full_name}</p>
        <p className="text-muted-foreground text-xs">{member.data?.email}</p>
        {member.data && (
          <Link
            to="/ScousGiftCardExchange/admin/users/$id"
            params={{ id: member.data.id }}
            className="text-primary mt-2 inline-block text-xs font-semibold"
          >
            View member
          </Link>
        )}
      </section>

      {(t.ecode || t.ecode_pin) && (
        <section className="border-border/70 bg-surface rounded-2xl border p-4">
          <p className="text-muted-foreground text-xs font-semibold uppercase">Card code</p>
          <p className="mt-1 font-mono text-sm break-all">{t.ecode}</p>
          {t.ecode_pin && <p className="text-muted-foreground font-mono text-xs">PIN {t.ecode_pin}</p>}
        </section>
      )}

      {(images.data ?? []).length > 0 && (
        <section>
          <p className="text-muted-foreground text-xs font-semibold uppercase">Uploaded proof</p>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
            {(images.data ?? []).map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer">
                <img
                  src={src}
                  alt={`Submitted card ${i + 1}`}
                  className="h-40 w-full rounded-xl object-cover"
                />
              </a>
            ))}
          </div>
        </section>
      )}

      {t.user_note && (
        <section className="border-border/70 bg-surface rounded-2xl border p-4">
          <p className="text-muted-foreground text-xs font-semibold uppercase">Member note</p>
          <p className="mt-1 text-sm">{t.user_note}</p>
        </section>
      )}

      {pending ? (
        <section className="border-border/70 bg-surface space-y-3 rounded-2xl border p-4">
          <textarea
            rows={2}
            placeholder="Note to the member (shown with the decision)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => review.mutate("successful")}
              className="bg-money-gradient text-background flex items-center justify-center gap-2 rounded-full py-3 text-sm font-bold"
            >
              {review.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Valid — pay{" "}
              {naira(t.expected_payout)}
            </button>
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => review.mutate("error")}
              className="border-destructive/50 text-destructive rounded-full border py-3 text-sm font-bold"
            >
              Invalid / error
            </button>
          </div>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              placeholder="Partial amount ₦"
              value={partial}
              onChange={(e) => setPartial(e.target.value.replace(/[^\d]/g, ""))}
              className="border-border bg-surface-2 flex-1 rounded-xl border px-3 py-3 text-sm"
            />
            <button
              type="button"
              disabled={review.isPending || !partial}
              onClick={() => review.mutate("partially_paid")}
              className="border-primary/50 text-primary rounded-full border px-5 text-sm font-bold disabled:opacity-40"
            >
              Pay partial
            </button>
          </div>
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate("used")}
            className="border-border text-muted-foreground w-full rounded-full border py-2.5 text-xs font-semibold"
          >
            Mark card as already used
          </button>
        </section>
      ) : (
        <section className="border-border/70 bg-surface rounded-2xl border p-4">
          <p className="text-sm">
            Reviewed {t.reviewed_at ? shortDate(t.reviewed_at) : ""} · paid {naira(t.paid_amount)}
          </p>
          {t.admin_note && <p className="text-muted-foreground mt-1 text-xs">{t.admin_note}</p>}
        </section>
      )}
    </div>
  );
}
