import { type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Show real router activity without hiding ready content or imposing a reveal delay.
 */
export function PageReveal({ children }: { children: ReactNode }) {
  const pending = useRouterState({ select: (s) => s.status === "pending" });

  return (
    <>
      {pending && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-1 bg-primary/25"
        >
          <span className="sr-only">Loading page…</span>
          <div className="h-full w-full bg-primary motion-safe:animate-pulse" />
        </div>
      )}
      {children}
    </>
  );
}
