import { createFileRoute } from "@tanstack/react-router";

const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
export async function avatarHandler(request: Request) {
  const { currentUserId } = await import("@/lib/guard.server");
  const { AvatarError, AVATAR_LIMIT, readAvatar, changeAvatar } = await import("@/lib/avatar.server");
  try {
    const user = await currentUserId();
    if (!user) return new Response("Please log in.", { status: 401, headers });
    if (request.method === "GET") {
      const object = await readAvatar(user);
      return object ? new Response(object.body, { headers: { ...headers, "Content-Type": "image/webp" } })
        : new Response("No profile photo.", { status: 404, headers });
    }
    // Custom header plus same-origin policy protects partitioned SameSite=None sessions.
    if (request.headers.get("X-Avatar-Request") !== "1" ||
        (request.headers.get("sec-fetch-site") === "cross-site"))
      return new Response("Not allowed.", { status: 403, headers });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > AVATAR_LIMIT) { await reader.cancel(); throw new AvatarError("Each photo must be 5MB or smaller.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const state = await changeAvatar(user, request.headers.get("X-Operation-Id") ?? "",
      request.headers.get("X-Avatar-Revision") ?? "", request.method === "DELETE" ? null : bytes,
      request.headers.get("Content-Type") ?? "");
    return Response.json({ revision: state.revision, hasPhoto: !!state.object_key }, { headers });
  } catch (error) {
    const known = error instanceof AvatarError;
    if (!known) console.error("Profile photo request failed");
    return new Response(known ? error.message : "Could not confirm the photo change. Retry the same request to check safely.",
      { status: known ? error.status : 503, headers });
  }
}
export const Route = createFileRoute("/api/avatar")({
  server: { handlers: { GET: ({ request }) => avatarHandler(request), POST: ({ request }) => avatarHandler(request),
    DELETE: ({ request }) => avatarHandler(request) } },
});
