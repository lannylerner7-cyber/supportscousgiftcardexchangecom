/** The member's own notification feed. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listNotifications = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { query } = await import("./d1.server");
  const userId = await requireUserId();
  const rows = await query<Record<string, unknown>>(
    `SELECT id, title, body, type, link, read_at, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    [userId],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    title: String(r["title"]),
    body: (r["body"] as string | null) ?? null,
    type: String(r["type"] ?? "info"),
    link: (r["link"] as string | null) ?? null,
    read_at: (r["read_at"] as string | null) ?? null,
    created_at: String(r["created_at"]),
  }));
});

export const markNotificationRead = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { execute, nowIso } = await import("./d1.server");
    const userId = await requireUserId();
    await execute(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
      [nowIso(), data.id, userId],
    );
    return { ok: true as const };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { execute, nowIso } = await import("./d1.server");
  const userId = await requireUserId();
  await execute("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", [
    nowIso(),
    userId,
  ]);
  return { ok: true as const };
});

export const unreadCount = createServerFn({ method: "GET" }).handler(async () => {
  const { currentUserId } = await import("./guard.server");
  const { queryOne } = await import("./d1.server");
  const userId = await currentUserId();
  if (!userId) return { count: 0 };
  const row = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL",
    [userId],
  );
  return { count: Number(row?.c ?? 0) };
});
