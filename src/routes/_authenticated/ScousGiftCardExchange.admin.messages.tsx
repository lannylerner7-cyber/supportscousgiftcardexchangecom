import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MailOpen } from "lucide-react";

import { adminListMessages, adminSetMessageRead } from "@/lib/admin.people.functions";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/messages")({
  component: AdminMessages,
});

function AdminMessages() {
  const qc = useQueryClient();

  const messages = useQuery({
    queryKey: ["admin-messages"],
    queryFn: () => adminListMessages(),
  });

  const toggleRead = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      adminSetMessageRead({ data: { id, read } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-messages"] }),
  });

  const list = messages.data ?? [];
  const unread = list.filter((m) => !m.read_at).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-bold">Messages</h1>
        <span className="text-muted-foreground text-xs">{unread} unread</span>
      </div>

      {list.length === 0 && <p className="text-muted-foreground text-sm">No messages yet.</p>}

      <div className="space-y-2">
        {list.map((m) => (
          <article
            key={m.id}
            className={cn(
              "border-border/70 bg-surface rounded-2xl border p-4",
              !m.read_at && "border-primary/50",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{m.name}</p>
                <p className="text-muted-foreground text-xs">
                  {m.email} · {shortDate(m.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleRead.mutate({ id: m.id, read: !m.read_at })}
                className="text-muted-foreground hover:text-primary flex items-center gap-1 text-xs font-semibold"
              >
                {m.read_at ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                {m.read_at ? "Mark unread" : "Mark read"}
              </button>
            </div>
            <p className="mt-3 text-sm whitespace-pre-wrap">{m.message}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
