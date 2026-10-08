/**
 * Private image upload (card proofs and chat images).
 *
 * Not under /api/public, so the published site requires a session. The handler
 * also checks the session itself and that the trade or thread belongs to the
 * person uploading.
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkImage, imageType, matchesImage } from "@/lib/image-validation";

export const Route = createFileRoute("/api/uploads")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { currentUserId } = await import("@/lib/guard.server");
          const { queryOne, execute, nowIso } = await import("@/lib/d1.server");
          const { putObject, extensionFor } = await import("@/lib/r2.server");
          const { createHash } = await import("node:crypto");

          const userId = await currentUserId();
          if (!userId) return new Response("Please log in.", { status: 401 });
          if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Not allowed", { status: 403 });
          if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024)
            return new Response("Upload too large.", { status: 413 });

          const { boundedBody } = await import("@/lib/bounded-body.server");
          const bounded = await boundedBody(request,11*1024*1024);
          if(!bounded)return new Response("Upload too large.",{status:413});
          const form = await new Response(bounded as BodyInit,{headers:{"Content-Type":request.headers.get("content-type")??""}}).formData();
          const file = form.get("file");
          const tradeId = form.get("tradeId");
          const threadId = form.get("threadId");

          // Multipart parsers may create File objects in a different runtime realm.
          if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function")
            return new Response("No file received.", { status: 400 });
          if (file.size === 0) return new Response("The photo is empty.", { status: 400 });
          const type = imageType(file.type, file.name);
          const problem = checkImage(type, file.size);
          if (problem) return new Response(problem, { status: 400 });
          const bytes = await file.arrayBuffer();
          if (!matchesImage(new Uint8Array(bytes), type))
            return new Response("This file does not match a supported photo format.", { status: 400 });

          if (typeof tradeId === "string" && tradeId) {
            const trade = await queryOne<{ id: string; status: string }>(
              "SELECT id, status FROM trades WHERE id = ? AND user_id = ?",
              [tradeId, userId],
            );
            if (!trade) return new Response("Unknown trade.", { status: 403 });

            // Content identity is scoped to THIS trade, never across separate submissions.
            // Reserve before PUT: an uncertain storage/DB response must not cause deletion
            // of an object another retry may already have committed.
            const hash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
            const id = createHash("sha256").update(`${userId}:${tradeId}:${hash}`).digest("hex");
            const key = `${userId}/${tradeId}/${hash}.${extensionFor(type)}`;
            const prior = await queryOne<{ kind: string; storage_path: string }>(
              "SELECT kind, storage_path FROM trade_images WHERE id=? AND user_id=?", [id, userId]);
            if (prior && prior.kind !== "uploading") return Response.json({ ok: true, path: prior.storage_path });
            if (trade.status !== "pending") return new Response("This trade is already reviewed. Contact support to add evidence.", { status: 409 });
            await execute(
                `INSERT INTO trade_images (id, trade_id, user_id, storage_path, kind, created_at)
                 SELECT ?, ?, ?, ?, 'uploading', ?
                 WHERE (SELECT COUNT(*) FROM trade_images WHERE trade_id = ?) < 5
                 AND EXISTS (SELECT 1 FROM trades WHERE id=? AND user_id=? AND status='pending')
                 ON CONFLICT(id) DO NOTHING`,
                [id, tradeId, userId, key, nowIso(), tradeId, tradeId, userId],
              );
            const reserved = await queryOne<{ storage_path: string; kind: string }>(
              "SELECT storage_path, kind FROM trade_images WHERE id=? AND user_id=?", [id, userId]);
            if (!reserved) return new Response("No photo slot is available. Retry the original missing photos, or contact support if the trade was reviewed.", { status: 409 });
            if (reserved.kind !== "uploading") return Response.json({ ok: true, path: reserved.storage_path });
            await putObject(reserved.storage_path, bytes, type);
            await execute("UPDATE trade_images SET kind='card' WHERE id=? AND user_id=?", [id, userId]);
            return Response.json({ ok: true, path: reserved.storage_path });
          }

          if (typeof threadId === "string" && threadId) {
            const { uploadSupportImage } = await import("@/lib/support-uploads.server");
            return Response.json(await uploadSupportImage(threadId,String(form.get("attachmentId")??""),bytes));
          }

          return new Response("Nothing to attach the file to.", { status: 400 });
        } catch (error) {
          if(error instanceof Error && error.name==="SupportError"){
            const status=(error as Error & {status:number}).status;
            return new Response(error.message,{status,headers:{"Cache-Control":"private, no-store"}});
          }
          console.error("Private image upload failed; details redacted");
          return new Response("The photo could not be uploaded. Please try again.", {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      },
    },
  },
});
