import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { adminListUsers } from "@/lib/admin.people.functions";
import { naira } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/users")({
  component: AdminUsers,
});

function AdminUsers() {
  const matches = useMatches();
  const isDetail = matches.some((m) => m.routeId.endsWith("/admin/users/$id"));
  const [term, setTerm] = useState("");

  const users = useQuery({
    queryKey: ["admin-users", term],
    queryFn: () => adminListUsers({ data: { term } }),
  });

  if (isDetail) return <Outlet />;

  const list = users.data ?? [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">Users</h1>
      <input
        placeholder="Search name or email"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        className="border-border bg-surface w-full rounded-xl border px-3 py-3 text-sm"
      />
      <div className="space-y-2">
        {list.map((u) => (
          <Link
            key={u.id}
            to="/ScousGiftCardExchange/admin/users/$id"
            params={{ id: u.id }}
            className="border-border/70 bg-surface hover:bg-surface-2 flex items-center justify-between rounded-2xl border p-4"
          >
            <div>
              <p className="text-sm font-semibold">{u.full_name || "Member"}</p>
              <p className="text-muted-foreground text-xs">{u.email}</p>
            </div>
            <p className="text-money text-sm font-bold">{naira(u.balance)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
