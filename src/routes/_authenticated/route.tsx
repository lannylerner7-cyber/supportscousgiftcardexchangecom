import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getAccount } from "@/lib/account.functions";
import { pendingOtpEmail } from "@/lib/otp-gate";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const account = await getAccount();
    if (!account.user) throw redirect({ to: "/login" });

    const pending = pendingOtpEmail();
    if (pending) {
      throw redirect({ to: "/login/verify", search: { email: pending } });
    }

    return { user: account.user, profile: account.profile, isAdmin: account.isAdmin };
  },
  component: () => <Outlet />,
});
