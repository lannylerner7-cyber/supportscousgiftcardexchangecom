import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { adminGetUser, adminAdjustWallet, adminSetFrozen } from "@/lib/admin.people.functions";
import { naira, shortDate, TRADE_STATUS_LABEL } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/users/$id")({
  component: AdminUserDetail,
});

function AdminUserDetail() {
  const { id } = useParams({ from: "/_authenticated/ScousGiftCardExchange/admin/users/$id" });
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const member = useQuery({
    queryKey: ["admin-user", id],
    queryFn: () => adminGetUser({ data: { userId: id } }),
  });

  const profile = { data: member.data?.profile ?? null };
  const wallet = { data: member.data?.wallet ?? null };
  const banks = { data: member.data?.banks ?? [] };
  const trades = { data: member.data?.trades ?? [] };
  const txns = { data: member.data?.transactions ?? [] };

  const adjust = useMutation({
    mutationFn: (sign: 1 | -1) => {
      const value = Number(amount || 0) * sign;
      if (!value) throw new Error("Enter an amount");
      return adminAdjustWallet({
        data: { userId: id, amount: value, note: note || "Manual adjustment" },
      });
    },
    onSuccess: () => {
      toast.success("Wallet updated");
      setAmount("");
      setNote("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setFrozen = useMutation({
    mutationFn: (freeze: boolean) =>
      adminSetFrozen({
        data: { userId: id, frozen: freeze, ...(freeze && note ? { reason: note } : {}) },
      }),
    onSuccess: () => {
      toast.success("Account updated");
      setNote("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const frozen = Boolean(profile.data?.frozen_at);

  return (
    <div className="space-y-5">
      <Link
        to="/ScousGiftCardExchange/admin/users"
        className="text-muted-foreground flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" /> Back to users
      </Link>

      <section className="border-border/70 bg-night-gradient rounded-3xl border p-6">
        <p className="font-display text-lg font-bold">{profile.data?.full_name}</p>
        <p className="text-muted-foreground text-xs">{profile.data?.email}</p>
        <p className="font-display text-money mt-4 text-3xl font-extrabold">
          {naira(wallet.data?.balance_naira ?? 0)}
        </p>
      </section>

      <section className="border-border/70 bg-surface space-y-2 rounded-2xl border p-4">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Account status</p>
        <p className="text-sm">
          {frozen
            ? `Frozen — ${profile.data?.frozen_reason ?? "no reason given"}`
            : "Active — trading and withdrawals allowed"}
        </p>
        <button
          type="button"
          disabled={setFrozen.isPending}
          onClick={() => setFrozen.mutate(!frozen)}
          className={
            frozen
              ? "bg-money-gradient text-background rounded-full px-5 py-2.5 text-xs font-bold"
              : "border-destructive/50 text-destructive rounded-full border px-5 py-2.5 text-xs font-bold"
          }
        >
          {frozen ? "Unfreeze account" : "Freeze account"}
        </button>
        {!frozen && (
          <p className="text-muted-foreground text-xs">
            The reason typed below is shown to the member when you freeze.
          </p>
        )}
      </section>

      <section className="border-border/70 bg-surface space-y-3 rounded-2xl border p-4">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Manual adjustment</p>
        <input
          inputMode="numeric"
          placeholder="Amount ₦"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
        />
        <input
          placeholder="Reason"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => adjust.mutate(1)}
            className="bg-money-gradient text-background rounded-full py-2.5 text-xs font-bold"
          >
            Credit
          </button>
          <button
            type="button"
            onClick={() => adjust.mutate(-1)}
            className="border-destructive/50 text-destructive rounded-full border py-2.5 text-xs font-bold"
          >
            Debit
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Bank accounts</p>
        {(banks.data ?? []).map((b) => (
          <div key={b.id} className="border-border/70 bg-surface rounded-2xl border p-4 text-sm">
            {b.bank_name} · {b.account_number} · {b.account_name}
          </div>
        ))}
        {(banks.data ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No bank saved.</p>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Trades</p>
        {(trades.data ?? []).map((t) => (
          <Link
            key={t.id}
            to="/ScousGiftCardExchange/admin/trades/$id"
            params={{ id: t.id }}
            className="border-border/70 bg-surface flex items-center justify-between rounded-2xl border p-4"
          >
            <span className="text-sm">
              {t.brand_name} · {t.currency} {t.face_value}
            </span>
            <span className="text-muted-foreground text-xs">
              {TRADE_STATUS_LABEL[t.status] ?? t.status} · {shortDate(t.created_at)}
            </span>
          </Link>
        ))}
      </section>

      <section className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Wallet activity</p>
        {(txns.data ?? []).map((x) => (
          <div
            key={x.id}
            className="border-border/70 bg-surface flex items-center justify-between rounded-2xl border p-4"
          >
            <span className="text-sm">
              {x.type} · {x.note}
            </span>
            <span className="text-muted-foreground text-xs">
              {naira(x.amount)} → {naira(x.balance_after)}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
