import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { AuthShell } from "@/components/AuthShell";
import { OtpForm } from "@/components/OtpForm";
import { clearOtpPending } from "@/lib/otp-gate";
import { getAccount } from "@/lib/account.functions";
import { supportReturn } from "@/lib/support-return";
import { useRefreshAccount } from "@/hooks/useAuth";

export const Route = createFileRoute("/login_/verify")({
  validateSearch: z.object({ email: z.string().email().optional(), exp: z.string().optional(),purpose:z.enum(["login","signup"]).optional(),support:z.unknown().optional().transform(supportReturn) }),
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
  const { email, exp,support,purpose } = Route.useSearch();
  const navigate = useNavigate();
  const refreshAccount = useRefreshAccount();

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
      subtitle={`Enter the 6-digit code emailed to ${email}. If delivery failed, use Send me a new code.`}
    >
      <OtpForm
        email={email}
        purpose={purpose ?? "login"}
        expiresAt={exp ?? null}
        onVerified={async () => {
          clearOtpPending();
          await refreshAccount();
          toast.success("Welcome back!");
          const acct = await getAccount().catch(() => null);
          if(support){window.location.assign(support);return;}
          void navigate({ to: acct?.isAdmin ? "/ScousGiftCardExchange/admin" : "/app" });
        }}
      />
    </AuthShell>
  );
}
