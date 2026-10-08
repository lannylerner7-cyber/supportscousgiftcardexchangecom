import { createFileRoute } from "@tanstack/react-router";
import { Outlet } from "@tanstack/react-router";

import { MemberShell } from "@/components/MemberShell";

export const Route = createFileRoute("/_authenticated/app")({
  component: () => (
    <MemberShell>
      <Outlet />
    </MemberShell>
  ),
});
