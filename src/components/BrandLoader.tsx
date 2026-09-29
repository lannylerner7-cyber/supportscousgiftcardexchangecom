import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

import { BrandMark } from "./BrandMark";

const REVEAL_MS = 5000;

export function BrandLoaderScreen({ label }: { label?: string }) {
  return (
    <div className="bg-night-gradient fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6">
      <div className="relative flex h-28 w-28 items-center justify-center">
        <span
          className="border-primary/25 border-t-primary absolute inset-0 rounded-full border-2"
          style={{ animation: "spin-slow 1.1s linear infinite" }}
        />
        <span
          className="border-money/20 border-b-money absolute inset-3 rounded-full border-2"
          style={{ animation: "spin-slow 1.7s linear infinite reverse" }}
        />
        <BrandMark className="h-11 w-11" />
      </div>
      <div className="text-center">
        <p className="font-display text-lg font-bold tracking-tight">ScousGiftCardExchange</p>
        <p className="text-muted-foreground mt-1 text-xs">{label ?? "Preparing your market…"}</p>
      </div>
      <div className="bg-surface-2 h-1 w-44 overflow-hidden rounded-full">
        <div
          className="bg-gold-gradient h-full w-full origin-left"
          style={{ animation: `shimmer-sweep ${REVEAL_MS}ms linear` }}
        />
      </div>
    </div>
  );
}

/**
 * Shows the branded loader for 5 seconds before revealing content,
 * on first load and on every route change.
 */
export function PageReveal({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const t = window.setTimeout(() => setReady(true), REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return (
    <>
      {!ready && <BrandLoaderScreen />}
      <div className={ready ? "animate-pop-in" : "pointer-events-none opacity-0"}>{children}</div>
    </>
  );
}
