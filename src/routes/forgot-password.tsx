import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AuthShell } from "@/components/AuthShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestOtp } from "@/lib/auth.functions";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — ScousGiftCardExchange" },
      { name: "description", content: "Send yourself a code to set a new password." },
      { property: "og:title", content: "Reset your password" },
      { property: "og:description", content: "Send yourself a code to set a new password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const address = email.trim().toLowerCase();
    const res = await requestOtp({ data: { email: address, purpose: "reset" } });
    setBusy(false);

    if (!res.ok) {
      toast.error(
        res.error === "cooldown"
          ? `A code was just sent. Try again in ${res.retryIn} seconds.`
          : "Too many code requests. Please try again later.",
      );
      return;
    }
    toast.success("If that email has an account, a 6-digit code is on its way.");
    void navigate({ to: "/reset-password", search: { email: address } });
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a 6-digit code to set a new password."
      footer={
        <Link to="/login" className="text-primary font-semibold">
          Back to login
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
        <button
          type="submit"
          disabled={busy}
          className="bg-gold-gradient text-primary-foreground flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Send reset code
        </button>
      </form>
    </AuthShell>
  );
}
