import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Bell } from "lucide-react";

import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notify.functions";
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

  const mark=useMutation({
    mutationFn:(id?:string)=>id?markNotificationRead({data:{id}}):markAllNotificationsRead(),
    onSuccess:()=>qc.invalidateQueries(),
  });



  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold">Notifications</h1>
      <button disabled={mark.isPending} onClick={()=>mark.mutate(undefined)} className="text-primary text-sm">Mark all as read</button>
      {mark.isError&&<p role="alert">Could not mark alerts as read. Please retry.</p>}
      {items.isError&&<p role="alert">Could not load notifications. Please retry.</p>}

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
          {!n.read_at&&<button disabled={mark.isPending} className="text-primary text-xs" onClick={()=>mark.mutate(n.id)}>Unread — mark as read</button>}
          {n.body && <p className="text-muted-foreground mt-1 text-xs">{n.body}</p>}
          <p className="text-muted-foreground mt-2 text-[10px]">{shortDate(n.created_at)}</p>
          {n.link&&/^\/(?:app(?:\/|$)|ScousGiftCardExchange\/admin(?:\/|$))/.test(n.link)&&<a href={n.link} className="text-primary text-sm">View update</a>}
        </div>
      ))}
    </div>
  );
}
