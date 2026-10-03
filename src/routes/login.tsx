import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { AuthShell } from "@/components/AuthShell";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";

import { Label } from "@/components/ui/label";
import { loginGate, recordLoginAttempt, requestOtp } from "@/lib/auth.functions";
import { getAccount, signIn } from "@/lib/account.functions";
import { useRefreshAccount } from "@/hooks/useAuth";
import { clearOtpPending, markOtpPending } from "@/lib/otp-gate";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — ScousGiftCardExchange" },
      { name: "description", content: "Log in to your wallet, trades and withdrawals." },
      { property: "og:title", content: "Log in to ScousGiftCardExchange" },
      { property: "og:description", content: "Access your wallet, trades and withdrawals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Login,
});

function lockMessage(until: string) {
  const t = new Date(until);
  return `Too many failed attempts. Try again after ${t.toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  })}.`;
}

function Login() {
  const navigate = useNavigate();
  const refreshAccount = useRefreshAccount();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", password: "" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const email = form.email.trim().toLowerCase();
    try {
      const gate = await loginGate({ data: { email } });
      if (!gate.ok) {
        setNotice(
          gate.error === "unknown_user"
            ? "We don't recognise that email. Check it or create an account."
            : lockMessage(gate.until!),
        );
        return;
      }

      const attempt = await signIn({ data: { email, password: form.password } });
      if (!attempt.ok) {
        const res = await recordLoginAttempt({ data: { email, succeeded: false } });
        setNotice(
          res.locked
            ? lockMessage(res.until!)
            : `Wrong password. ${res.remaining} ${res.remaining === 1 ? "try" : "tries"} left before a 30-minute lock.`,
        );
        return;
      }

      await recordLoginAttempt({ data: { email, succeeded: true } });
      await refreshAccount();

      // If the code email can't be requested, still go to the code screen;
      // the member can ask for a new code from there.
      const otp = await requestOtp({ data: { email, purpose: "login" } }).catch((err) => {
        console.error("Login code request failed", err);
        return null;
      });

      // Admins never get a code - the mail allowance is reserved for members.
      const skipCode =
        !!otp && otp.ok && (otp.adminBypass || (!otp.delivered && !otp.emailConfigured));
      if (!skipCode) {
        markOtpPending(email);
        void navigate({
          to: "/login/verify",
          search: { email, ...(otp?.ok && otp.expiresAt ? { exp: otp.expiresAt } : {}) },
        });
        return;
      }
      clearOtpPending();
      toast.success("Welcome back!");
      const acct = await getAccount().catch(() => null);
      void navigate({ to: acct?.isAdmin ? "/ScousGiftCardExchange/admin" : "/app" });
    } catch (err) {
      console.error("Login failed", err);
      setNotice("We couldn't log you in right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your wallet, trades and withdrawals."
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="text-primary font-semibold">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {notice && (
          <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-xl border px-4 py-3 text-sm">
            {notice}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-primary text-xs font-semibold">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            required
            autoComplete="current-password"
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
          />

        </div>

        <button
          type="submit"
          disabled={busy}
          className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Log in
        </button>
      </form>
    </AuthShell>
  );
}
