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
        // Profile photos have a separate owner-only endpoint, including for admins.
        if (key.startsWith("avatars/")) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
        if (!key || key.includes("..")) return new Response("Not found", { status: 404 });

        const userId = await currentUserId();
        if (!userId) return new Response("Please log in.", { status: 401 });

        if (key.includes("/chat/")) {
          const {queryOne}=await import("@/lib/d1.server");
          const attachment=await queryOne(`SELECT a.id FROM support_attachments a
            JOIN chat_threads t ON t.id=a.thread_id
            WHERE a.path=? AND a.ready=1 AND (t.user_id=? OR EXISTS(
              SELECT 1 FROM user_roles WHERE user_id=? AND role='admin'))`,[key,userId,userId]);
          if(!attachment)return new Response("Not found",{status:404,headers:{"Cache-Control":"private, no-store"}});
        }

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
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
