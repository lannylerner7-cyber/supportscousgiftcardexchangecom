/**
 * Container health check. Reports the app, the database and file storage.
 * Returns 200 only when the database answers; Docker and Cloudflare use this.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        let database = "down";
        let storage = "unknown";

        try {
          const { queryOne } = await import("@/lib/d1.server");
          const row = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM gift_card_brands");
          database = (row?.c ?? 0) >= 0 ? "ok" : "down";
        } catch (error) {
          console.error("[health] database check failed", (error as Error).message);
        }

        storage = process.env["R2_BUCKET"] ? "configured" : "not_configured";
        const email = process.env["SMTP_HOST"] ? "configured" : "not_configured";
        const healthy = database === "ok";

        return Response.json(
          {
            ok: healthy,
            status: healthy ? "ok" : "degraded",
            database,
            storage,
            email,
            latency_ms: Date.now() - started,
            time: new Date().toISOString(),
          },
          {
            status: healthy ? 200 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      },
    },
  },
});
