import { createFileRoute } from "@tanstack/react-router";

import { ComingSoon } from "@/components/ComingSoon";

export const Route = createFileRoute("/_authenticated/app/chat")({
  component: () => (
    <ComingSoon
      title="Chat with support"
      body="Live chat with our review desk arrives in a later build phase."
    />
  ),
});
