import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const KEYS = [
  ["rates-table"],
  ["public-brands"],
  ["public-top-rates"],
  ["market-brands"],
  ["market-variants"],
  ["admin-brands"],
  ["admin-variants"],
];

/**
 * Keeps every market/rate screen in sync with the admin panel.
 *
 * D1 has no push channel, so open pages re-check the rates every 30 seconds
 * and immediately whenever the tab is brought back to the front.
 */
export function useMarketRealtime(intervalMs = 30_000) {
  const qc = useQueryClient();

  useEffect(() => {
    const invalidate = () => {
      for (const key of KEYS) void qc.invalidateQueries({ queryKey: key });
    };

    const timer = window.setInterval(invalidate, intervalMs);
    const onFocus = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [qc, intervalMs]);
}
