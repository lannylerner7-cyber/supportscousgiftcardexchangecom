/**
 * Private file serving. A stored image is only ever returned to the member who
 * uploaded it or to an admin, and it is never cached by a shared cache.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { currentUserId, isAdmin } = await import("@/lib/guard.server");
        const { getObject } = await import("@/lib/r2.server");

        const key = params._splat ?? "";
        if (!key || key.includes("..")) return new Response("Not found", { status: 404 });

        const userId = await currentUserId();
        if (!userId) return new Response("Please log in.", { status: 401 });

        // Keys always start with the owner's id.
        const owner = key.split("/")[0];
        if (owner !== userId && !(await isAdmin(userId))) {
          return new Response("Not allowed", { status: 403 });
        }

        const object = await getObject(key);
        if (!object) return new Response("Not found", { status: 404 });

        return new Response(object.body, {
          headers: {
            "Content-Type": object.contentType,
            "Cache-Control": "private, max-age=300",
          },
        });
      },
    },
  },
});
