import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AuthShell } from "@/components/AuthShell";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { resetPasswordWithCode } from "@/lib/auth.functions";
import { useRefreshAccount } from "@/hooks/useAuth";
import { clearOtpPending } from "@/lib/otp-gate";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) =>
    z.object({ email: z.string().email().optional() }).parse(search),
  head: () => ({
    meta: [
      { title: "Set a new password — ScousGiftCardExchange" },
      { name: "description", content: "Enter your emailed code and choose a new password." },
      { property: "og:title", content: "Set a new password" },
      { property: "og:description", content: "Enter your emailed code and choose a new password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const refreshAccount = useRefreshAccount();
  const [email, setEmail] = useState(search.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Use at least 8 characters.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    const res = await resetPasswordWithCode({
      data: { email: email.trim().toLowerCase(), code, password },
    });
    setBusy(false);

    if (!res.ok) {
      const message =
        res.error === "expired"
          ? "That code has expired. Request a new one."
          : res.error === "no_code"
            ? "No code is waiting for that email. Request a new one."
            : res.error === "attempts"
              ? "Too many wrong tries. Request a new code."
              : `Wrong code. ${res.remaining} ${res.remaining === 1 ? "try" : "tries"} left.`;
      toast.error(message);
      return;
    }

    clearOtpPending();
    await refreshAccount();
    toast.success("Password updated.");
    void navigate({ to: "/app" });
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Enter the code we emailed you, then pick a new password."
      footer={
        <Link to="/forgot-password" className="text-primary font-semibold">
          Send a new code
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="text-center text-lg tracking-[0.5em]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <PasswordInput
            id="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Update password
        </button>
      </form>
    </AuthShell>
  );
}
