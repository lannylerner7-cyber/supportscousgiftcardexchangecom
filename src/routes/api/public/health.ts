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
          const { databaseReady } = await import("@/lib/readiness.server");
          database = await databaseReady() ? "ok" : "down";
        } catch (error) {
          console.error("[health] database check failed");
        }

        storage = process.env["R2_BUCKET"] ? "configured" : "not_configured";
        const { emailConfigured } = await import("@/lib/email.server");
        let email = "not_configured";
        try {
          email = emailConfigured() ? "configured" : "not_configured";
        } catch {
          email = "invalid_configuration";
        }
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
