import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { clearOtpPending, markOtpPending } from "@/lib/otp-gate";
import { AuthShell } from "@/components/AuthShell";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";

import { Label } from "@/components/ui/label";
import { completeSignup, requestOtp } from "@/lib/auth.functions";
import { signUp } from "@/lib/account.functions";
import { useRefreshAccount } from "@/hooks/useAuth";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your account — ScousGiftCardExchange" },
      {
        name: "description",
        content: "Sign up in under a minute and start trading gift cards for Naira.",
      },
      { property: "og:title", content: "Create your ScousGiftCardExchange account" },
      { property: "og:description", content: "Trade gift cards for Naira with honest rates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const refreshAccount = useRefreshAccount();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", referralCode: "" });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      toast.error("Use a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    const email = form.email.trim().toLowerCase();
    const created = await signUp({
      data: {
        email,
        password: form.password,
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        ...(form.referralCode.trim() ? { referralCode: form.referralCode.trim().toUpperCase() } : {}),
      },
    });

    if (!created.ok) {
      setBusy(false);
      toast.error("That email already has an account. Try logging in.");
      return;
    }
    await refreshAccount();

    const done = await completeSignup({ data: { email, fullName: form.fullName.trim() } });
    if (done.verifiedWithoutEmail) {
      clearOtpPending();
      setBusy(false);
      toast.success("Account created. Welcome aboard!");
      void navigate({ to: "/app" });
      return;
    }

    const otp = await requestOtp({ data: { email, purpose: "signup" } });
    if (!(otp.ok && !otp.delivered && !otp.emailConfigured)) markOtpPending(email);
    setBusy(false);
    void navigate({
      to: "/verify-email",
      search: { email, ...(otp.ok ? { exp: otp.expiresAt } : {}) },
    });
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Trade gift cards for Naira at rates you can see up front."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-semibold">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" required value={form.fullName} onChange={set("fullName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={set("email")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone number</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="080..."
            value={form.phone}
            onChange={set("phone")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="referralCode">Referral code (optional)</Label>
          <Input
            id="referralCode"
            placeholder="Friend's code"
            value={form.referralCode}
            onChange={set("referralCode")}
          />
          <p className="text-muted-foreground text-xs">
            You both get ₦2,000, unlocked after your first redeemed card.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            required
            autoComplete="new-password"
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
          />

          <p className="text-muted-foreground text-xs">At least 8 characters.</p>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </button>

        <p className="text-muted-foreground text-center text-xs">
          By continuing you agree to our{" "}
          <Link to="/terms" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}
