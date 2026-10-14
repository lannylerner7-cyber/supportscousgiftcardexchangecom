import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AuthShell } from "@/components/AuthShell";
import { useRefreshAccount } from "@/hooks/useAuth";
import { clearOtpPending } from "@/lib/otp-gate";
import { beginPasskeyLogin, finishPasskeyLogin } from "@/lib/passkey.functions";
import { passkeyError, passkeySupport, safeMemberReturn, supportMessage } from "@/lib/passkey-client";

export const Route = createFileRoute("/login_/passkey")({
  validateSearch: (s: Record<string, unknown>): { next?: string | undefined } => ({ next: safeMemberReturn(s["next"]) }),
  head: () => ({ meta: [{ title: "Log in with a passkey — ScousGiftCardExchange" }] }),
  component: PasskeyLogin,
});

function PasskeyLogin() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const refreshAccount = useRefreshAccount();
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inflight = useRef(false);
  const unsupported = typeof window === "undefined" ? null : supportMessage(passkeySupport());

  async function go() {
    if (inflight.current || unsupported) return;
    inflight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const optionsJSON = await beginPasskeyLogin({ data: { remember } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await startAuthentication({ optionsJSON: optionsJSON as any });
      const res = await finishPasskeyLogin({ data: { response } });
      if (!res?.ok) throw new Error("We couldn't verify that passkey. Try again or use your password.");
      clearOtpPending();
      await refreshAccount();
      toast.success("Welcome back!");
      void navigate({ to: next ?? "/app", replace: true });
    } catch (e) {
      setNotice(passkeyError(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Passkey log in"
      subtitle="Use your fingerprint, face or screen lock."
      footer={<>Prefer your password? <Link to="/login" className="text-primary font-semibold">Log in with email</Link></>}
    >
      <div className="space-y-4">
        <div className="flex justify-center py-2">
          <span className="bg-gold-gradient text-primary-foreground grid h-16 w-16 place-items-center rounded-2xl">
            <Fingerprint className="h-8 w-8" />
          </span>
        </div>
        {unsupported && (
          <p className="border-border bg-surface-2 rounded-xl border px-4 py-3 text-sm" data-testid="text-passkey-unsupported">{unsupported}</p>
        )}
        {notice && (
          <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-xl border px-4 py-3 text-sm" role="alert">{notice}</p>
        )}
        {!unsupported && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-primary" />
              Keep me signed in on this device
            </label>
            <button type="button" onClick={go} disabled={busy} data-testid="button-passkey-login"
              className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Waiting for your device" : notice ? "Try again" : "Continue with passkey"}
            </button>
          </>
        )}
        <Link to="/login" className="border-border block w-full rounded-full border py-3 text-center text-sm font-semibold">
          Use password instead
        </Link>
        <p className="text-muted-foreground text-center text-xs">
          Lost your device? Log in with your password and email code, then remove the old passkey in Settings.
        </p>
      </div>
    </AuthShell>
  );
}
