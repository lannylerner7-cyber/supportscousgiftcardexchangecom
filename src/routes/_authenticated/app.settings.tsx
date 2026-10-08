import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Lock, LogOut, Plus, Shield, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { getAccount, signOut as signOutFn } from "@/lib/account.functions";
import { listBanks } from "@/lib/catalog.functions";
import {
  addBankAccount,
  listMyBankAccounts,
  removeBankAccount,
  setDefaultBankAccount,
  withdrawalPinStatus,
} from "@/lib/wallet.functions";
import { setWithdrawalPin } from "@/lib/pin.functions";
import { useIsAdmin, useSession } from "@/hooks/useAuth";
import { requestOtp } from "@/lib/auth.functions";
import { resetWithdrawalPin } from "@/lib/pin.functions";
import { cn } from "@/lib/utils";
import { AccountControls } from "@/components/AccountControls";
import { ProfilePhotoControls } from "@/components/ProfilePhoto";
import { SupportChatButton } from "@/components/support/SupportChatButton";

export const Route = createFileRoute("/_authenticated/app/settings")({
  component: Settings,
});

type PinStatus = {
  has_pin: boolean;
  locked_until: string | null;
  frozen: boolean;
  frozen_reason: string | null;
};

function Settings() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const { isAdmin } = useIsAdmin();

  const [adding, setAdding] = useState(false);
  const [bankId, setBankId] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetCode, setResetCode] = useState("");

  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: async () => (await getAccount()).profile,
  });

  const banks = useQuery({
    queryKey: ["bank-list"],
    queryFn: () => listBanks(),
  });

  const accounts = useQuery({
    queryKey: ["my-banks"],
    queryFn: () => listMyBankAccounts(),
  });

  const addAccount = useMutation({
    mutationFn: async () => {
      if (!bankId) throw new Error("Choose your bank");
      if (accountNumber.length !== 10) throw new Error("Account number must be 10 digits");
      const res = await addBankAccount({
        data: { bankId, accountNumber, accountName: accountName.trim() },
      });
      if (!res.ok) {
        throw new Error(
          res.error === "too_many"
            ? "You can save up to 5 bank accounts"
            : "We could not find that bank",
        );
      }
    },
    onSuccess: () => {
      toast.success("Bank account saved");
      setAdding(false);
      setBankId("");
      setAccountNumber("");
      setAccountName("");
      void qc.invalidateQueries({ queryKey: ["my-banks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => setDefaultBankAccount({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["my-banks"] }),
  });

  const removeAccount = useMutation({
    mutationFn: (id: string) => removeBankAccount({ data: { id } }),
    onSuccess: () => {
      toast.success("Bank account removed");
      void qc.invalidateQueries({ queryKey: ["my-banks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pinStatus = useQuery({
    queryKey: ["pin-status"],
    queryFn: (): Promise<PinStatus> => withdrawalPinStatus(),
  });

  const savePin = useMutation({
    mutationFn: async () => {
      if (!/^\d{4}$/.test(newPin)) throw new Error("PIN must be 4 digits");
      const res = await setWithdrawalPin({
        data: { pin: newPin, ...(pinStatus.data?.has_pin ? { currentPin } : {}) },
      });
      if (!res.ok) throw new Error("That current PIN is not correct");
    },
    onSuccess: () => {
      toast.success("Withdrawal PIN saved");
      setNewPin("");
      setCurrentPin("");
      void qc.invalidateQueries({ queryKey: ["pin-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startReset = useMutation({
    mutationFn: async () => {
      const email = profile.data?.email;
      if (!email) throw new Error("No email on file");
      const res = await requestOtp({ data: { email, purpose: "pin" } });
      if (!res.ok) throw new Error("Please wait a moment before asking for another code");
    },
    onSuccess: () => {
      setResetting(true);
      toast.success("We sent a code to your email");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finishReset = useMutation({
    mutationFn: async () => {
      const res = await resetWithdrawalPin({ data: { code: resetCode, pin: newPin } });
      if (!res.ok) {
        throw new Error(
          res.error === "wrong"
            ? "Invalid OTP — check the code and try again."
            : "That code has expired. Send a new one.",
        );
      }
    },
    onSuccess: () => {
      toast.success("Withdrawal PIN updated");
      setResetting(false);
      setResetCode("");
      setNewPin("");
      void qc.invalidateQueries({ queryKey: ["pin-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await signOutFn();
    void navigate({ to: "/login", replace: true });
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-xl font-bold">Settings</h1>

      <section className="border-border/70 bg-surface rounded-2xl border p-5">
        <ProfilePhotoControls />
        <p className="text-sm font-semibold">{profile.data?.full_name ?? "Member"}</p>
        <p className="text-muted-foreground text-xs">{profile.data?.email}</p>
        {profile.data?.phone && (
          <p className="text-muted-foreground text-xs">{profile.data.phone}</p>
        )}
      </section>

      <section className="border-primary/40 bg-primary/10 rounded-2xl border p-5">
        <p className="text-sm font-semibold">Invite a friend</p>
        <p className="text-muted-foreground mt-1 text-xs">
                Share your code — you earn ₦2,000 when your friend verifies their email. Their ₦5,000 welcome bonus unlocks after their first successful card redemption.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <span className="font-display text-primary text-xl font-extrabold tracking-[0.25em]">
            {profile.data?.referral_code ?? "—"}
          </span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(profile.data?.referral_code ?? "");
              toast.success("Referral code copied");
            }}
            className="border-border rounded-full border px-3 py-1.5 text-xs font-semibold"
          >
            Copy
          </button>
        </div>
      </section>

      <SupportChatButton />

      {pinStatus.data?.frozen && (
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-2xl border px-4 py-3 text-sm">
          Your account is frozen. {pinStatus.data.frozen_reason ?? "Contact support for details."}
        </p>
      )}

      <section className="border-border/70 bg-surface space-y-3 rounded-2xl border p-5">
        <div className="flex items-center gap-2">
          <Lock className="text-primary h-4 w-4" />
          <p className="text-sm font-semibold">
            {pinStatus.data?.has_pin ? "Change withdrawal PIN" : "Set withdrawal PIN"}
          </p>
        </div>
        <p className="text-muted-foreground text-xs">
          You'll be asked for this 4-digit PIN every time you request a withdrawal.
        </p>

        {resetting ? (
          <>
            <input
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code from your email"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value.replace(/[^\d]/g, ""))}
              className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
            />
            <input
              inputMode="numeric"
              type="password"
              maxLength={4}
              placeholder="New 4-digit PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/[^\d]/g, ""))}
              className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
            />
            <button
              type="button"
              disabled={finishReset.isPending || resetCode.length !== 6 || newPin.length !== 4}
              onClick={() => finishReset.mutate()}
              className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-50"
            >
              {finishReset.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save new PIN
            </button>
            <button
              type="button"
              onClick={() => setResetting(false)}
              className="text-muted-foreground w-full text-center text-xs"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {pinStatus.data?.has_pin && (
              <input
                inputMode="numeric"
                type="password"
                maxLength={4}
                placeholder="Current PIN"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/[^\d]/g, ""))}
                className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
              />
            )}
            <input
              inputMode="numeric"
              type="password"
              maxLength={4}
              placeholder={pinStatus.data?.has_pin ? "New 4-digit PIN" : "Choose a 4-digit PIN"}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/[^\d]/g, ""))}
              className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
            />
            <button
              type="button"
              disabled={savePin.isPending || newPin.length !== 4}
              onClick={() => savePin.mutate()}
              className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-50"
            >
              {savePin.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save PIN
            </button>
            {pinStatus.data?.has_pin && (
              <button
                type="button"
                disabled={startReset.isPending}
                onClick={() => startReset.mutate()}
                className="text-primary w-full text-center text-xs font-semibold"
              >
                Forgot my PIN — email me a code
              </button>
            )}
          </>
        )}
      </section>


      {isAdmin && (
        <a
          href="/ScousGiftCardExchange/admin"
          className="border-primary/40 bg-primary/10 text-primary flex items-center justify-center gap-2 rounded-2xl border py-3.5 text-sm font-semibold"
        >
          <Shield className="h-4 w-4" /> Open admin panel
        </a>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs font-semibold uppercase">Bank accounts</p>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-primary flex items-center gap-1 text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        {adding && (
          <div className="border-border/70 bg-surface space-y-3 rounded-2xl border p-4">
            <select
              value={bankId}
              onChange={(e) => setBankId(e.target.value)}
              className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
            >
              <option value="">Select bank</option>
              {(banks.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.is_digital ? " (digital)" : ""}
                </option>
              ))}
            </select>
            <input
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit account number"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/[^\d]/g, ""))}
              className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
            />
            <input
              placeholder="Account name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
            />
            <button
              type="button"
              disabled={addAccount.isPending}
              onClick={() => addAccount.mutate()}
              className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold"
            >
              {addAccount.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save account
            </button>
          </div>
        )}

        {(accounts.data ?? []).map((a) => (
          <div
            key={a.id}
            className="border-border/70 bg-surface flex items-center justify-between rounded-2xl border p-4"
          >
            <div>
              <p className="text-sm font-semibold">{a.bank_name}</p>
              <p className="text-muted-foreground text-xs">
                {a.account_number} · {a.account_name}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => makeDefault.mutate(a.id)}
                aria-label="Set as default"
                className={cn(a.is_default ? "text-primary" : "text-muted-foreground")}
              >
                <Star className={cn("h-4 w-4", a.is_default && "fill-current")} />
              </button>
              <button
                type="button"
                onClick={() => removeAccount.mutate(a.id)}
                aria-label="Remove account"
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {(accounts.data ?? []).length === 0 && !adding && (
          <p className="text-muted-foreground text-sm">No bank account saved yet.</p>
        )}
      </section>

      <AccountControls />

      <button
        type="button"
        onClick={signOut}
        className="border-destructive/40 text-destructive hover:bg-destructive/10 flex w-full items-center justify-center gap-2 rounded-full border py-3.5 text-sm font-semibold"
      >
        <LogOut className="h-4 w-4" /> Log out
      </button>
    </div>
  );
}
