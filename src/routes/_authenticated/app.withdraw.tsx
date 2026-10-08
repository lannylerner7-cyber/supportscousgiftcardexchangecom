import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import {
  createWithdrawal,
  getWallet,
  listMyBankAccounts,
  listMyWithdrawals,
  withdrawalPinStatus,
} from "@/lib/wallet.functions";
import { naira, shortDate, WITHDRAWAL_FEE, WITHDRAWAL_STATUS_LABEL } from "@/lib/format";
import { notifyWithdrawalRequested } from "@/lib/alerts.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/withdraw")({
  component: Withdraw,
});

type PinStatus = {
  has_pin: boolean;
  locked_until: string | null;
  frozen: boolean;
  frozen_reason: string | null;
};

function Withdraw() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [bankId, setBankId] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["pin-status"],
    queryFn: (): Promise<PinStatus> => withdrawalPinStatus(),
  });

  const wallet = useQuery({
    queryKey: ["wallet"],
    refetchInterval: 15_000,
    queryFn: () => getWallet(),
  });

  const banks = useQuery({
    queryKey: ["my-banks"],
    queryFn: () => listMyBankAccounts(),
  });

  const history = useQuery({
    queryKey: ["my-withdrawals"],
    queryFn: () => listMyWithdrawals(),
  });

  const locked = Number(wallet.data?.locked_naira ?? 0);
  const balance = Math.max(Number(wallet.data?.balance_naira ?? 0) - locked, 0);
  const value = Number(amount || 0);
  const selected = bankId ?? banks.data?.find((b) => b.is_default)?.id ?? banks.data?.[0]?.id ?? null;
  const net = Math.max(value - WITHDRAWAL_FEE, 0);
  const frozen = status.data?.frozen ?? false;
  const hasPin = status.data?.has_pin ?? false;
  const pinLocked =
    status.data?.locked_until != null && new Date(status.data.locked_until) > new Date();

  const request = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Add a bank account first");
      if (!/^\d{4}$/.test(pin)) throw new Error("Enter your 4-digit withdrawal PIN");
      const row = await createWithdrawal({
        data: { bankAccountId: selected!, amount: value, pin },
      });
      // Alert the desk; a mail problem must never undo the request.
      void notifyWithdrawalRequested({ data: { withdrawalId: row.id } }).catch(() => undefined);
      return row;
    },
    onSuccess: () => {
      toast.success("Withdrawal requested — your balance has been debited");
      setAmount("");
      setPin("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <h1 className="font-display text-xl font-bold">Withdraw</h1>

      {frozen && (
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-2xl border px-4 py-3 text-sm">
          Your account is frozen, so withdrawals are paused.{" "}
          {status.data?.frozen_reason ?? "Contact support for details."}
        </p>
      )}

      <section className="border-border/70 bg-night-gradient rounded-3xl border p-6">
        <p className="text-muted-foreground text-xs">Available to withdraw</p>
        <p className="font-display text-money mt-1 text-3xl font-extrabold">{naira(balance)}</p>
        {locked > 0 && (
          <p className="text-warning mt-2 text-xs">
            {naira(locked)} bonus stays locked until your first card is redeemed
          </p>
        )}
      </section>

      {!hasPin && !status.isLoading && (
        <div className="border-primary/40 bg-primary/10 rounded-2xl border p-5 text-center">
          <Lock className="text-primary mx-auto h-5 w-5" />
          <p className="mt-2 text-sm font-semibold">Set your withdrawal PIN first</p>
          <p className="text-muted-foreground mt-1 text-xs">
            A 4-digit PIN is asked every time you withdraw.
          </p>
          <Link
            to="/app/settings"
            className="bg-gold-gradient text-primary-foreground mt-4 inline-flex rounded-full px-5 py-2.5 text-sm font-bold"
          >
            Set my PIN
          </Link>
        </div>
      )}

      {(banks.data ?? []).length === 0 ? (
        <div className="border-border/70 bg-surface rounded-2xl border p-6 text-center">
          <p className="text-sm font-semibold">No bank account saved</p>
          <Link
            to="/app/settings"
            className="bg-gold-gradient text-primary-foreground mt-4 inline-flex rounded-full px-5 py-2.5 text-sm font-bold"
          >
            Add a bank account
          </Link>
        </div>
      ) : (
        <section className="space-y-3">
          <p className="text-muted-foreground text-xs font-semibold uppercase">Pay into</p>
          {(banks.data ?? []).map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBankId(b.id)}
              className={cn(
                "border-border/70 bg-surface flex w-full items-center justify-between rounded-2xl border p-4 text-left",
                selected === b.id && "border-primary",
              )}
            >
              <span>
                <span className="block text-sm font-semibold">{b.bank_name}</span>
                <span className="text-muted-foreground text-xs">
                  {b.account_number} · {b.account_name}
                </span>
              </span>
              {b.is_default && <span className="text-primary text-[10px] font-bold">DEFAULT</span>}
            </button>
          ))}

          <label className="block">
            <span className="text-muted-foreground text-xs font-medium">Amount (₦)</span>
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Minimum 1,000"
              className="border-border bg-surface focus:border-primary font-display mt-2 w-full rounded-2xl border px-4 py-4 text-2xl font-bold outline-none"
            />
          </label>

          <div className="border-border/70 bg-surface space-y-1 rounded-2xl border p-4 text-sm">
            <Row label="Amount" value={naira(value)} />
            <Row label="Transfer fee" value={`- ${naira(WITHDRAWAL_FEE)}`} />
            <div className="border-border/60 mt-2 border-t pt-2">
              <Row label="You receive" value={naira(net)} strong />
            </div>
          </div>

          {hasPin && (
            <label className="block">
              <span className="text-muted-foreground text-xs font-medium">Withdrawal PIN</span>
              <input
                inputMode="numeric"
                type="password"
                maxLength={4}
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="••••"
                className="border-border bg-surface focus:border-primary mt-2 w-full rounded-2xl border px-4 py-3 text-center text-xl font-bold tracking-[0.6em] outline-none"
              />
              {pinLocked && (
                <span className="text-destructive mt-1 block text-xs">
                  PIN entry is locked for a short while after too many wrong tries.
                </span>
              )}
            </label>
          )}

          <button
            type="button"
            disabled={
              value < 1000 ||
              value > balance ||
              request.isPending ||
              frozen ||
              !hasPin ||
              pinLocked ||
              pin.length !== 4
            }
            onClick={() => request.mutate()}
            className="bg-money-gradient text-background flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-40"
          >
            {request.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm withdrawal
          </button>
          {value > balance && (
            <p className="text-destructive text-center text-xs">Amount is more than your balance.</p>
          )}
        </section>
      )}

      <section className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold uppercase">Withdrawal history</p>
        {(history.data ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No withdrawals yet.</p>
        )}
        {(history.data ?? []).map((w) => {
          const snap = (w.bank_snapshot ?? {}) as { bank_name?: string };
          return (
            <div
              key={w.id}
              className="border-border/70 bg-surface flex items-center justify-between rounded-2xl border p-4"
            >
              <div>
                <p className="text-sm font-semibold">
                  Withdrawal {naira(w.amount)} to {snap.bank_name ?? "bank"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {shortDate(w.created_at)} · net {naira(w.net_amount)}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[10px] font-semibold",
                  w.status === "paid"
                    ? "bg-money/15 text-money"
                    : w.status === "cancelled"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-warning/15 text-warning",
                )}
              >
                {WITHDRAWAL_STATUS_LABEL[w.status] ?? w.status}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={strong ? "text-money font-display text-base font-bold" : "text-sm"}>
        {value}
      </span>
    </div>
  );
}
