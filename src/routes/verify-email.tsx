import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { AuthShell } from "@/components/AuthShell";
import { OtpForm } from "@/components/OtpForm";
import { clearOtpPending } from "@/lib/otp-gate";

export const Route = createFileRoute("/verify-email")({
  validateSearch: z.object({ email: z.string().email().optional(), exp: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Verify your email — ScousGiftCardExchange" },
      { name: "description", content: "Enter the 6-digit code we emailed to finish signing up." },
      { property: "og:title", content: "Verify your email" },
      { property: "og:description", content: "Enter your 6-digit sign-up code." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VerifyEmail,
});

function VerifyEmail() {
  const { email, exp } = Route.useSearch();
  const navigate = useNavigate();

  if (!email) {
    return (
      <AuthShell title="Verify your email" subtitle="We need to know which account to verify.">
        <button
          onClick={() => navigate({ to: "/signup" })}
          className="bg-gold-gradient text-primary-foreground w-full rounded-full py-3.5 text-sm font-bold"
        >
          Back to sign up
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Check your email" subtitle={`We sent a 6-digit code to ${email}.`}>
      <OtpForm
        email={email}
        purpose="signup"
        expiresAt={exp ?? null}
        onVerified={() => {
          clearOtpPending();
          toast.success("Email verified. Welcome aboard!");
          void navigate({ to: "/app" });
        }}
      />
    </AuthShell>
  );
}
