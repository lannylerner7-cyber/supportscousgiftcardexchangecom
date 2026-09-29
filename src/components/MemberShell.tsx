import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Home, Repeat, Clock, Wallet, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { BrandWordmark } from "./BrandMark";

const TABS = [
  { to: "/app", label: "Home", icon: Home },
  { to: "/app/trade", label: "Trade", icon: Repeat },
  { to: "/app/history", label: "History", icon: Clock },
  { to: "/app/withdraw", label: "Withdraw", icon: Wallet },
  { to: "/app/settings", label: "Settings", icon: Settings },
] as const;

export function MemberShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen pb-24">
      <header className="border-border/60 bg-background/80 sticky top-0 z-30 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/app">
            <BrandWordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>

      <nav className="border-border/60 bg-background/90 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-stretch justify-between px-2">
          {TABS.map((t) => {
            const active = t.to === "/app" ? pathname === "/app" : pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <t.icon className={cn("h-5 w-5", active && "scale-110")} />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
