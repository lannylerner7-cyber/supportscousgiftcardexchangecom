import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { adminListWithdrawals, adminWithdrawalDecision } from "@/lib/admin.functions";
import { naira, shortDate, WITHDRAWAL_STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/withdrawals")({
  component: AdminWithdrawals,
});

const FILTERS = ["requested", "approved", "paid", "cancelled", "all"] as const;

function AdminWithdrawals() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("requested");
  const [note, setNote] = useState("");

  const list = useQuery({
    queryKey: ["admin-withdrawals", filter],
    refetchInterval: 20000,
    queryFn: () => adminListWithdrawals({ data: { status: filter } }),
  });

  const decide = useMutation({
    mutationFn: (args: { id: string; status: "approved" | "paid" | "cancelled" }) =>
      adminWithdrawalDecision({ data: { ...args, ...(note ? { note } : {}) } }),
    onSuccess: () => {
      toast.success("Withdrawal updated");
      setNote("");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">Withdrawals</h1>

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
            {f === "all" ? "All" : (WITHDRAWAL_STATUS_LABEL[f] ?? f)}
          </button>
        ))}
      </div>

      <input
        placeholder="Optional note added to the next decision"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="border-border bg-surface w-full rounded-xl border px-3 py-3 text-sm"
      />

      <div className="space-y-2">
        {(list.data ?? []).map((w) => {
          const snap = w.bank_snapshot as {
            bank_name?: string;
            account_number?: string;
            account_name?: string;
          };
          return (
            <div key={w.id} className="border-border/70 bg-surface rounded-2xl border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {naira(w.amount)} → {snap.bank_name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {snap.account_number} · {snap.account_name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Net {naira(w.net_amount)} · fee {naira(w.fee)} · {shortDate(w.created_at)}
                  </p>
                </div>
                <span className="bg-surface-2 rounded-full px-2.5 py-1 text-[10px] font-semibold">
                  {WITHDRAWAL_STATUS_LABEL[w.status] ?? w.status}
                </span>
              </div>
              {w.status !== "paid" && w.status !== "cancelled" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {w.status === "requested" && (
                    <button
                      type="button"
                      onClick={() => decide.mutate({ id: w.id, status: "approved" })}
                      className="border-primary/50 text-primary rounded-full border px-4 py-2 text-xs font-bold"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => decide.mutate({ id: w.id, status: "paid" })}
                    className="bg-money-gradient text-background rounded-full px-4 py-2 text-xs font-bold"
                  >
                    Mark as paid
                  </button>
                  <button
                    type="button"
                    onClick={() => decide.mutate({ id: w.id, status: "cancelled" })}
                    className="border-destructive/50 text-destructive rounded-full border px-4 py-2 text-xs font-bold"
                  >
                    Decline & refund
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!list.isLoading && (list.data ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">Nothing in this view.</p>
        )}
      </div>
    </div>
  );
}
