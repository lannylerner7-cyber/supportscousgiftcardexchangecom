import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, Headset, X } from "lucide-react";

import { MemberChat, SUPPORT_SUMMARY_KEY, useSupportSummary } from "./MemberChat";

/** Settings entry: button with unread badge, opens the persistent support chat. */
export function SupportChatButton() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const summary = useSupportSummary(!open);
  const unread = summary.data?.unread ?? 0;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) void qc.invalidateQueries({ queryKey: SUPPORT_SUMMARY_KEY });
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="border-border/70 bg-surface hover:border-primary/50 group flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors"
          data-testid="button-open-support-chat"
        >
          <span className="bg-primary/15 text-primary relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <Headset className="h-5 w-5" />
            {unread > 0 && (
              <span
                className="bg-destructive text-background absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                data-testid="badge-support-unread"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold">Chat with support</span>
            <span className="text-muted-foreground block text-xs">
              {unread > 0
                ? `${unread} unread ${unread === 1 ? "reply" : "replies"}`
                : summary.isError
                  ? "Unread count unavailable right now"
                  : "Your conversation is saved to your account"}
            </span>
          </span>
          <ChevronRight className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
          {unread > 0 && <span className="sr-only">{unread} unread support messages</span>}
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby="support-chat-desc"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById("support-composer")?.focus({ preventScroll: true });
          }}
          className="bg-background border-border/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col overflow-hidden rounded-t-3xl border shadow-2xl duration-300 sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:h-[min(720px,88dvh)] sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:slide-in-from-bottom-0"
          data-testid="dialog-support-chat"
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden />
          <header className="border-border/70 flex items-center gap-3 border-b px-4 py-3">
            <span className="bg-primary/15 text-primary flex h-9 w-9 items-center justify-center rounded-full">
              <Headset className="h-4.5 w-4.5" />
            </span>
            <div className="flex-1">
              <DialogPrimitive.Title className="font-display text-sm font-bold">Scous support</DialogPrimitive.Title>
              <DialogPrimitive.Description id="support-chat-desc" className="text-muted-foreground text-[11px]">
                Messages are saved. You can close this and come back.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="text-muted-foreground hover:text-foreground hover:bg-surface-2 rounded-full p-2 transition-colors"
              aria-label="Close support chat"
              data-testid="button-close-support-chat"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </header>
          <MemberChat active={open} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
