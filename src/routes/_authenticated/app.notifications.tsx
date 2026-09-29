import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Bell } from "lucide-react";

import { listNotifications, markAllNotificationsRead } from "@/lib/notify.functions";
import { shortDate } from "@/lib/format";
import { playChime } from "@/lib/sounds";

export const Route = createFileRoute("/_authenticated/app/notifications")({
  component: Notifications,
});

function Notifications() {
  const qc = useQueryClient();

  const items = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
    // No push channel on our own database, so the feed refreshes on a timer
    // and whenever the member comes back to the tab.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const seen = useRef(0);
  useEffect(() => {
    const count = items.data?.length ?? 0;
    if (seen.current && count > seen.current) playChime();
    seen.current = count;
  }, [items.data]);

  // Opening the page marks everything as read.
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current || !items.data?.some((n) => !n.read_at)) return;
    markedRef.current = true;
    void markAllNotificationsRead()
      .then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))
      .catch(() => undefined);
  }, [items.data, qc]);



  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold">Notifications</h1>

      {items.isLoading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface-2 shimmer h-20 rounded-2xl" />
        ))}

      {!items.isLoading && (items.data ?? []).length === 0 && (
        <div className="border-border/70 bg-surface rounded-2xl border p-10 text-center">
          <Bell className="text-muted-foreground mx-auto h-6 w-6" />
          <p className="mt-2 text-sm font-semibold">Nothing yet</p>
        </div>
      )}

      {(items.data ?? []).map((n) => (
        <div key={n.id} className="border-border/70 bg-surface rounded-2xl border p-4">
          <p className="text-sm font-semibold">{n.title}</p>
          {n.body && <p className="text-muted-foreground mt-1 text-xs">{n.body}</p>}
          <p className="text-muted-foreground mt-2 text-[10px]">{shortDate(n.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
