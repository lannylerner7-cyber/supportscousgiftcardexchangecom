import { createFileRoute } from "@tanstack/react-router";

import { MemberChat } from "@/components/support/MemberChat";

export const Route = createFileRoute("/_authenticated/app/chat")({
  component: ChatPage,
});

function ChatPage() {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-xl font-bold">Chat with support</h1>
        <p className="text-muted-foreground text-xs">Your conversation is saved to your account.</p>
      </div>
      <div className="border-border/70 bg-surface flex h-[calc(100dvh-13rem)] min-h-[440px] flex-col overflow-hidden rounded-2xl border">
        <MemberChat />
      </div>
    </div>
  );
}
