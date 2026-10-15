import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authenticatePasskey } from "@/lib/passkey-transport";
import { Fingerprint, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { AuthShell } from "@/components/AuthShell";
import { useRefreshAccount } from "@/hooks/useAuth";
import { clearOtpPending } from "@/lib/otp-gate";
import { beginPasskeyLogin, finishPasskeyLogin, loginVerificationChoice } from "@/lib/passkey.functions";
import { requestOtp } from "@/lib/auth.functions";
import { getAccount } from "@/lib/account.functions";
import { supportReturn } from "@/lib/support-return";
import { passkeyError, passkeySupport, safeMemberReturn, supportMessage } from "@/lib/passkey-client";

export const Route = createFileRoute("/login_/passkey")({
  validateSearch: (s: Record<string, unknown>): { next?: string | undefined; support?: string | undefined } =>
    ({ next: safeMemberReturn(s["next"]), support: supportReturn(s["support"]) }),
  head: () => ({ meta: [{ title: "Verify your login — ScousGiftCardExchange" }] }),
  component: PasskeyLogin,
});

function PasskeyLogin() {
  const { next, support } = Route.useSearch();
  const navigate = useNavigate();
  const refreshAccount = useRefreshAccount();
  const [busy, setBusy] = useState<"passkey" | "email" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inflight = useRef(false);
  const unsupported = typeof window === "undefined" ? null : supportMessage(passkeySupport());
  const choice = useQuery({
    queryKey: ["login-verification"], queryFn: () => loginVerificationChoice(),
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: true,
  });
  const state = choice.data;

  async function finish() {
    clearOtpPending();
    await refreshAccount();
    const acct = await getAccount();
    if (support) { window.location.assign(support); return; }
    void navigate({ to: acct.isAdmin ? "/ScousGiftCardExchange/admin" : next ?? "/app", replace: true });
  }
  useEffect(() => {
    if (state?.state === "verified") void finish().catch(() => setNotice("Please return to login and try again."));
  }, [state?.state]);

  async function go() {
    if (inflight.current || unsupported || !state?.hasPasskey || state.state !== "pending") return;
    inflight.current = true;
    setBusy("passkey");
    setNotice(null);
    try {
      const optionsJSON = await beginPasskeyLogin({ data: { remember: state.remember } });
      const response = await authenticatePasskey(optionsJSON);
      const res = await finishPasskeyLogin({ data: { response } });
      if (!res?.ok) throw new Error("We couldn't verify that passkey. Try again or use your password.");
      await finish();
      toast.success("Welcome back!");
    } catch (e) {
      setNotice(passkeyError(e));
    } finally {
      inflight.current = false;
      setBusy(null);
    }
  }
  async function sendCode() {
    if (inflight.current || state?.state !== "pending") return;
    inflight.current = true; setBusy("email"); setNotice(null);
    try {
      const result = await requestOtp({ data: { email: state.email, purpose: state.purpose } });
      if (!result.ok) {
        setNotice("Please wait before requesting another code, then try again.");
        return;
      }
      // A provider timeout may have delivered the code. The verification screen
      // retains retry/resend support instead of blocking access after an uncertain send.
      void navigate({ to: "/login/verify", search: {
        email: state.email, purpose: state.purpose, support,
        ...(result.expiresAt ? { exp: result.expiresAt } : {}),
      } });
    } catch {
      setNotice("We couldn't request a code. Please retry, or return to login if your session expired.");
    } finally { inflight.current = false; setBusy(null); }
  }

  return (
    <AuthShell
      title="Verify your login"
      subtitle={state?.state === "pending"
        ? "Your email and password have been checked. Choose how to continue."
        : "Choose how to verify after entering your email and password."}
      footer={<Link to="/login" search={{ support }} className="text-primary font-semibold">Back to login</Link>}
    >
      <div className="space-y-4">
        <div className="flex justify-center py-2">
          <span className="bg-gold-gradient text-primary-foreground grid h-16 w-16 place-items-center rounded-2xl">
            <Fingerprint className="h-8 w-8" />
          </span>
        </div>
        {choice.isPending && <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading verification options…</p>}
        {choice.isError && <div role="alert" className="text-sm text-destructive">We couldn't load your verification options. <button onClick={() => void choice.refetch()} className="underline">Retry</button></div>}
        {state?.state === "expired" && <p role="alert" className="text-sm">Your login session has ended. Enter your email and password again.</p>}
        {unsupported && state?.hasPasskey && (
          <p className="border-border bg-surface-2 rounded-xl border px-4 py-3 text-sm" data-testid="text-passkey-unsupported">{unsupported}</p>
        )}
        {notice && (
          <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-xl border px-4 py-3 text-sm" role="alert">{notice}</p>
        )}
        {state?.state === "pending" && (
          <>
            {state.remember && <p className="text-muted-foreground text-xs">After verification, keep me signed in for up to 30 days.</p>}
            <button type="button" onClick={go} disabled={!!busy || !state.hasPasskey || !!unsupported} data-testid="button-passkey-login"
              className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-60">
              {busy === "passkey" && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy === "passkey" ? "Waiting for your device" : "Continue with passkey"}
            </button>
            {!state.hasPasskey && <p className="text-muted-foreground text-xs">
              {state.enabled
                ? "You haven't set up a passkey. Verify by email first, then we'll offer to create one."
                : "Passkeys are unavailable right now. Continue with an email code."}
            </p>}
            <button type="button" onClick={sendCode} disabled={!!busy} data-testid="button-send-login-code"
              className="border-border flex w-full items-center justify-center gap-2 rounded-full border py-3.5 text-sm font-semibold disabled:opacity-60">
              {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {busy === "email" ? "Requesting code…" : "Send code to email"}
            </button>
            <p className="text-muted-foreground text-center text-xs">No email code is sent unless you choose it.</p>
          </>
        )}
      </div>
    </AuthShell>
  );
}
