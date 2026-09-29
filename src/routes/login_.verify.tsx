import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { AuthShell } from "@/components/AuthShell";
import { OtpForm } from "@/components/OtpForm";
import { clearOtpPending } from "@/lib/otp-gate";

export const Route = createFileRoute("/login_/verify")({
  validateSearch: z.object({ email: z.string().email().optional(), exp: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Confirm it's you — ScousGiftCardExchange" },
      { name: "description", content: "Enter the 6-digit login code we just emailed you." },
      { property: "og:title", content: "Confirm it's you" },
      { property: "og:description", content: "Enter your 6-digit login code." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginVerify,
});

function LoginVerify() {
  const { email, exp } = Route.useSearch();
  const navigate = useNavigate();

  if (!email) {
    return (
      <AuthShell title="Confirm it's you" subtitle="Start again from the login page.">
        <button
          onClick={() => navigate({ to: "/login" })}
          className="bg-gold-gradient text-primary-foreground w-full rounded-full py-3.5 text-sm font-bold"
        >
          Back to login
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Confirm it's you"
      subtitle={`We sent a fresh 6-digit code to ${email}. It only works once.`}
    >
      <OtpForm
        email={email}
        purpose="login"
        expiresAt={exp ?? null}
        onVerified={() => {
          clearOtpPending();
          toast.success("Welcome back!");
          void navigate({ to: "/app" });
        }}
      />
    </AuthShell>
  );
}
