import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getAccount } from "@/lib/account.functions";
import { pendingOtpEmail } from "@/lib/otp-gate";
import { supportReturn } from "@/lib/support-return";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({location}) => {
    const support=supportReturn(location.pathname+location.searchStr);
    const account = await getAccount();
    if (!account.user) throw redirect({ to: "/login",search:{support} });

    const pending = pendingOtpEmail();
    if (pending) {
      throw redirect({ to: "/login/verify", search: { email: pending,support } });
    }

    return { user: account.user, profile: account.profile, isAdmin: account.isAdmin };
  },
  component: () => <Outlet />,
});
