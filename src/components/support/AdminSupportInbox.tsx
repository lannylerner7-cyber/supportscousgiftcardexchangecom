import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, LogIn, LogOut, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { presenceActive, supportApi, timeLabel, type Thread } from "./api";
import { Conversation } from "./Conversation";
import { SUPPORT_SUMMARY_KEY } from "./MemberChat";

const LIST_KEY = ["support-threads"] as const;

export function AdminSupportInbox({
  threadId,
  onSelect,
}: {
  threadId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { user } = useSession();
  const qc = useQueryClient();

  const list = useInfiniteQuery({
    queryKey: LIST_KEY,
    queryFn: ({ pageParam }) => supportApi.list(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => {
      if (!last.hasMore) return undefined;
      const t = last.threads[last.threads.length - 1];
      return typeof t?.cursor === "number" ? t.cursor : undefined;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const inboxLive = useInboxStream(() => {
    void qc.invalidateQueries({ queryKey: LIST_KEY });
    void qc.invalidateQueries({ queryKey: SUPPORT_SUMMARY_KEY });
  });

  const threads = (list.data?.pages ?? []).flatMap((p) => p.threads);
  const seen = new Set<string>();
  const unique = threads.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  const selected = unique.find((t) => t.id === threadId) ?? null;

  const patchThread = (t: Thread) =>
    qc.setQueryData(LIST_KEY, (old: typeof list.data) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({ ...p, threads: p.threads.map((x) => (x.id === t.id ? t : x)) })),
          }
        : old,
    );

  return (
    <div className="border-border/70 bg-surface grid h-[calc(100dvh-11rem)] min-h-[520px] overflow-hidden rounded-2xl border md:grid-cols-[300px_1fr]">
      <aside className={cn("border-border/70 flex min-h-0 flex-col md:border-r", threadId && "hidden md:flex")}>
        <div className="border-border/70 flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-xs font-semibold tracking-wide uppercase">Conversations</p>
            <p className="text-muted-foreground text-[10px]" role="status" data-testid="status-inbox-live">
              {inboxLive ? "Live updates on" : "Live updates off · refreshing every 30s"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void list.refetch()}
            aria-label="Refresh conversations"
            className="text-muted-foreground hover:text-primary"
            data-testid="button-refresh-threads"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", list.isFetching && "animate-spin")} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-surface-2 h-14 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : list.isError ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <AlertCircle className="text-destructive h-5 w-5" />
              <p className="text-xs">{(list.error as Error).message}</p>
              <button type="button" onClick={() => void list.refetch()} className="text-primary text-xs font-semibold">
                Retry
              </button>
            </div>
          ) : unique.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-xs">
              No support conversations yet. New chats from members appear here.
            </p>
          ) : (
            <ul>
              {unique.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    aria-current={t.id === threadId ? "true" : undefined}
                    className={cn(
                      "border-border/40 hover:bg-surface-2 flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors",
                      t.id === threadId && "bg-surface-2",
                    )}
                    data-testid={`row-thread-${t.id}`}
                  >
                    <span className="bg-primary/15 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                      {initials(t.full_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn("truncate text-sm", t.unread_for_admin ? "font-bold" : "font-medium")}>
                          {t.full_name ?? "Member"}
                        </span>
                        {t.resolved ? (
                          <CheckCircle2 className="text-muted-foreground h-3 w-3 shrink-0" aria-label="Resolved" />
                        ) : null}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                        {t.last_message_at ? timeLabel(t.last_message_at) : "No messages"}
                        {presenceActive(t) && <span className="text-primary">· agent joined</span>}
                      </span>
                    </span>
                    {t.unread_for_admin > 0 && (
                      <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                        {t.unread_for_admin}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <button
              type="button"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
              className="text-primary w-full py-3 text-xs font-semibold"
              data-testid="button-more-threads"
            >
              {list.isFetchingNextPage ? "Loading" : "Load older conversations"}
            </button>
          )}
        </div>
      </aside>

      <section className={cn("flex min-h-0 flex-col", !threadId && "hidden md:flex")}>
        {threadId ? (
          <Conversation
            key={threadId}
            threadId={threadId}
            userId={user?.id ?? null}
            viewer="admin"
            onThreadChange={(t) => t && patchThread(t)}
            header={(thread, setThread) => (
              <ThreadHeader
                thread={thread ?? selected}
                onBack={() => onSelect(null)}
                onThread={(t) => {
                  setThread(t);
                  patchThread(t);
                }}
              />
            )}
          />
        ) : (
          <div className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-center text-sm">
            Choose a conversation to read and reply.
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Inbox-wide SSE. Coalesces bursts of `inbox` events into one refresh (250ms window).
 * Closed while the tab is hidden, on unmount and on `revoked`; the 30s poll remains the fallback.
 * Returns true only while the stream has actually sent `ready`.
 */
function useInboxStream(onChange: () => void) {
  const [live, setLive] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let revoked = false;
    let flush: ReturnType<typeof setTimeout> | null = null;

    const close = () => {
      es?.close();
      es = null;
      setLive(false);
    };
    const schedule = () => {
      if (flush) return;
      flush = setTimeout(() => {
        flush = null;
        cb.current();
      }, 250);
    };
    const open = () => {
      if (es || revoked || document.visibilityState !== "visible") return;
      es = new EventSource("/api/support?threadId=inbox", { withCredentials: true });
      es.addEventListener("ready", () => {
        setLive(true);
        schedule(); // catch up on anything missed while closed
      });
      es.addEventListener("inbox", schedule);
      es.addEventListener("revoked", () => {
        revoked = true;
        close();
      });
      es.onerror = () => {
        setLive(false); // browser may auto-reconnect; status returns on next 'ready'
        if (es?.readyState === EventSource.CLOSED) es = null;
      };
    };
    const onVis = () => (document.visibilityState === "visible" ? open() : close());

    open();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (flush) clearTimeout(flush);
      close();
    };
  }, []);

  return live;
}

function ThreadHeader({
  thread,
  onBack,
  onThread,
}: {
  thread: Thread | null;
  onBack: () => void;
  onThread: (t: Thread) => void;
}) {
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState<"join" | "resolve" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onThreadRef = useRef(onThread);
  onThreadRef.current = onThread;
  const id = thread?.id;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Renew 45s presence only while explicitly joined and the tab is visible.
  useEffect(() => {
    if (!joined || !id) return;
    const renew = () => {
      if (document.visibilityState !== "visible") return;
      supportApi
        .join(id)
        .then((r) => r.thread && onThreadRef.current(r.thread))
        .catch(() => {
          setJoined(false);
          toast.error("Presence could not be renewed. You are no longer shown as joined.");
        });
    };
    const t = setInterval(renew, 20_000);
    document.addEventListener("visibilitychange", renew);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", renew);
    };
  }, [joined, id]);

  if (!thread) return null;
  const until = thread.joined_until ? new Date(thread.joined_until).getTime() : 0;
  const live = until > now;
  const secs = Math.max(0, Math.round((until - now) / 1000));

  const join = async () => {
    setBusy("join");
    try {
      const r = await supportApi.join(thread.id);
      if (r.thread) onThread(r.thread);
      else onThread({ ...thread, joined_until: new Date(Date.now() + 45_000).toISOString() });
      setJoined(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (resolved: boolean) => {
    setBusy("resolve");
    try {
      const r = await supportApi.resolve(thread.id, resolved);
      onThread(r.thread ?? { ...thread, resolved: resolved ? 1 : 0 });
      toast.success(resolved ? "Marked resolved. History is kept." : "Conversation reopened");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-border/70 flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
      <button type="button" onClick={onBack} aria-label="Back to conversations" className="text-muted-foreground p-1 md:hidden">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" data-testid="text-thread-name">
          {thread.full_name ?? "Member"}
        </p>
        <p className="text-muted-foreground text-[11px]" data-testid="status-thread-presence">
          {thread.resolved ? "Resolved · " : ""}
          {live
            ? joined
              ? `You are shown as joined · renews while this tab is open`
              : `An admin is joined · expires in ${secs}s unless renewed`
            : "No admin joined · member sees no presence"}
        </p>
      </div>
      {joined ? (
        <button
          type="button"
          onClick={() => setJoined(false)}
          className="border-border flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
          title="Stops renewing. Presence expires within 45 seconds."
          data-testid="button-leave-thread"
        >
          <LogOut className="h-3.5 w-3.5" /> Leave
        </button>
      ) : (
        <button
          type="button"
          onClick={join}
          disabled={busy === "join"}
          className="bg-gold-gradient text-primary-foreground flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-50"
          data-testid="button-join-thread"
        >
          {busy === "join" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
          Join
        </button>
      )}
      <button
        type="button"
        onClick={() => resolve(!thread.resolved)}
        disabled={busy === "resolve"}
        className="border-border hover:border-primary/50 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        data-testid="button-resolve-thread"
      >
        {busy === "resolve" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : thread.resolved ? (
          <RotateCcw className="h-3.5 w-3.5" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        {thread.resolved ? "Reopen" : "Resolve"}
      </button>
    </div>
  );
}

export function SupportDiagnostics() {
  const d = useQuery({
    queryKey: ["support-diagnostics"],
    queryFn: () => supportApi.diagnostics(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  return (
    <section className="border-border/70 bg-surface rounded-2xl border p-5" data-testid="card-support-diagnostics">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Support notification queue</p>
        <button type="button" onClick={() => void d.refetch()} className="text-muted-foreground" aria-label="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", d.isFetching && "animate-spin")} />
        </button>
      </div>
      {d.isLoading ? (
        <div className="bg-surface-2 mt-3 h-10 animate-pulse rounded-xl" />
      ) : d.isError ? (
        <p className="text-destructive mt-2 text-xs">{(d.error as Error).message}</p>
      ) : (
        <div className="mt-3 flex gap-6">
          <div>
            <p className="font-display text-xl font-bold">{d.data?.pending ?? 0}</p>
            <p className="text-muted-foreground text-[11px]">Pending deliveries</p>
          </div>
          <div>
            <p className={cn("font-display text-xl font-bold", (d.data?.exhausted ?? 0) > 0 && "text-destructive")}>
              {d.data?.exhausted ?? 0}
            </p>
            <p className="text-muted-foreground text-[11px]">Gave up after retries</p>
          </div>
        </div>
      )}
    </section>
  );
}

function initials(name: string | null) {
  if (!name) return "M";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}
