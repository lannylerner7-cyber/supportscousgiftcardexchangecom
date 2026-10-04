/**
 * Private image upload (card proofs and chat images).
 *
 * Not under /api/public, so the published site requires a session. The handler
 * also checks the session itself and that the trade or thread belongs to the
 * person uploading.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/uploads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { currentUserId } = await import("@/lib/guard.server");
          const { queryOne, execute, newId, nowIso } = await import("@/lib/d1.server");
          const { putObject, checkImage, extensionFor } = await import("@/lib/r2.server");

          const userId = await currentUserId();
          if (!userId) return new Response("Please log in.", { status: 401 });

          const form = await request.formData();
          const file = form.get("file");
          const tradeId = form.get("tradeId");
          const threadId = form.get("threadId");

          if (!(file instanceof File)) return new Response("No file received.", { status: 400 });
          const problem = checkImage(file.type, file.size);
          if (problem) return new Response(problem, { status: 400 });

          if (typeof tradeId === "string" && tradeId) {
            const trade = await queryOne<{ id: string }>(
              "SELECT id FROM trades WHERE id = ? AND user_id = ?",
              [tradeId, userId],
            );
            if (!trade) return new Response("Unknown trade.", { status: 403 });

            const count = await queryOne<{ c: number }>(
              "SELECT COUNT(*) AS c FROM trade_images WHERE trade_id = ?",
              [tradeId],
            );
            if ((count?.c ?? 0) >= 5)
              return new Response("That trade already has 5 photos.", { status: 400 });

            const key = `${userId}/${tradeId}/${newId()}.${extensionFor(file.type)}`;
            await putObject(key, await file.arrayBuffer(), file.type);
            await execute(
              `INSERT INTO trade_images (id, trade_id, user_id, storage_path, kind, created_at)
               VALUES (?, ?, ?, ?, 'card', ?)`,
              [newId(), tradeId, userId, key, nowIso()],
            );
            return Response.json({ ok: true, path: key });
          }

          if (typeof threadId === "string" && threadId) {
            const thread = await queryOne<{ id: string }>(
              "SELECT id FROM chat_threads WHERE id = ? AND user_id = ?",
              [threadId, userId],
            );
            if (!thread) return new Response("Unknown conversation.", { status: 403 });

            const key = `${userId}/chat/${threadId}/${newId()}.${extensionFor(file.type)}`;
            await putObject(key, await file.arrayBuffer(), file.type);
            return Response.json({ ok: true, path: key });
          }

          return new Response("Nothing to attach the file to.", { status: 400 });
        } catch (error) {
          console.error("Private image upload failed", error);
          return new Response("The photo could not be uploaded. Please try again.", {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      },
    },
  },
});
