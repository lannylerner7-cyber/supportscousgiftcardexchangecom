import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import {
  Banknote,
  ClipboardList,
  LayoutDashboard,
  Mail,
  MessageSquare,
  ScrollText,
  Tags,
  Users,
} from "lucide-react";

import { getAccount } from "@/lib/account.functions";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin")({
  beforeLoad: async () => {
    const account = await getAccount();
    if (!account.isAdmin) throw redirect({ to: "/app" });
  },
  component: AdminShell,
});

const NAV = [
  { to: "/ScousGiftCardExchange/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/ScousGiftCardExchange/admin/trades", label: "Trades", icon: ClipboardList },
  { to: "/ScousGiftCardExchange/admin/withdrawals", label: "Withdrawals", icon: Banknote },
  { to: "/ScousGiftCardExchange/admin/users", label: "Users", icon: Users },
  { to: "/ScousGiftCardExchange/admin/closures", label: "Closures", icon: Users },
  { to: "/ScousGiftCardExchange/admin/rates", label: "Market & rates", icon: Tags },
  { to: "/ScousGiftCardExchange/admin/messages", label: "Messages", icon: MessageSquare },
  { to: "/ScousGiftCardExchange/admin/mail", label: "Mail & alerts", icon: Mail },
  { to: "/ScousGiftCardExchange/admin/audit", label: "Audit log", icon: ScrollText },
] as const;

function AdminShell() {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-3">
          <BrandMark className="h-9 w-9" />
          <div>
            <p className="font-display text-base font-bold">Admin console</p>
            <p className="text-muted-foreground text-xs">ScousGiftCardExchange</p>
          </div>
        </div>
        <Link to="/app" className="text-muted-foreground text-xs font-semibold">
          Member view
        </Link>
      </header>

      <nav className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: Boolean((n as { exact?: boolean }).exact) }}
            activeProps={{ className: "border-primary bg-primary/10 text-primary" }}
            className="border-border text-muted-foreground flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold whitespace-nowrap"
          >
            <n.icon className="h-3.5 w-3.5" />
            {n.label}
          </Link>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
