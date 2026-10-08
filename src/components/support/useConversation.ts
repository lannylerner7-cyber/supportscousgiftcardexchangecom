import { useCallback, useEffect, useRef, useState } from "react";

import { SupportError, isDenied, supportApi, type Message, type Thread } from "./api";

export type Connection = "connecting" | "live" | "fallback" | "offline";

const SSE_BATCH_CAP = 100;
const FALLBACK_MS = 5000;
const ERROR_GRACE_MS = 5000; // CONNECTING after error longer than this -> fallback
const READY_TIMEOUT_MS = 10000; // no 'ready' within this -> fallback
const RECONNECT_EVERY = 3; // fallback polls between SSE reconnect attempts

function mergeMessages(prev: Message[], incoming: Message[]) {
  if (!incoming.length) return prev;
  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, { ...map.get(m.id), ...m });
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

export function useConversation(threadId: string | null, active: boolean) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [thread, setThreadState] = useState<Thread | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<SupportError | null>(null);
  const [denied, setDenied] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [reloadKey, setReloadKey] = useState(0);

  const maxSeq = useRef(0);
  const onIncoming = useRef<(m: Message[]) => void>(() => {});
  /** Bumped on thread switch, reload and revoke. Async results from an old generation are dropped. */
  const gen = useRef(0);
  const currentThread = useRef<string | null>(threadId);

  const isCurrent = (g: number, id: string) =>
    g === gen.current && currentThread.current === id;

  const apply = useCallback((g: number, id: string, incoming: Message[], t?: Thread) => {
    if (g !== gen.current || currentThread.current !== id) return;
    const mine = incoming.filter((m) => m.thread_id === id);
    if (mine.length) {
      maxSeq.current = Math.max(maxSeq.current, ...mine.map((m) => m.seq));
      setMessages((prev) => mergeMessages(prev, mine));
      onIncoming.current(mine);
    }
    if (t && t.id === id)
      setThreadState((prev) =>
        prev && prev.id === t.id ? { ...prev, ...t, full_name: t.full_name ?? prev.full_name } : t,
      );
  }, []);

  /** For callers outside the hook (e.g. a completed send). Guarded by thread identity. */
  const applyExternal = useCallback(
    (m: Message[], forThread: string) => apply(gen.current, forThread, m),
    [apply],
  );
  const setThread = useCallback(
    (t: Thread) => {
      if (t.id === currentThread.current) apply(gen.current, t.id, [], t);
    },
    [apply],
  );

  const catchUp = useCallback(
    async (g: number, id: string) => {
      for (let i = 0; i < 20; i++) {
        if (!isCurrent(g, id)) return;
        const res = await supportApi.history(id, { after: maxSeq.current });
        if (!isCurrent(g, id)) return;
        apply(g, id, res.messages, res.thread);
        if (!res.hasMore || !res.messages.length) break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply],
  );

  // Initial page: newest 50, ascending.
  useEffect(() => {
    currentThread.current = threadId;
    const g = ++gen.current;
    maxSeq.current = 0;
    setMessages([]);
    setThreadState(null);
    setHasMore(false);
    setLoadingOlder(false);
    setError(null);
    setDenied(false);
    setRevoked(false);
    setLoading(true);
    if (!threadId || !active) return;
    supportApi
      .history(threadId)
      .then((res) => {
        if (!isCurrent(g, threadId)) return;
        apply(g, threadId, res.messages, res.thread);
        setHasMore(res.hasMore);
      })
      .catch((e: SupportError) => {
        if (!isCurrent(g, threadId)) return;
        if (isDenied(e)) setDenied(true);
        setError(e);
      })
      .finally(() => isCurrent(g, threadId) && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, active, reloadKey, apply]);

  // Live updates: SSE with honest, bounded fallback to polling.
  useEffect(() => {
    if (!threadId || !active || loading || error || revoked) return;
    const id = threadId;
    const g = gen.current;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let polls = 0;
    let wasLive = false;
    let stopped = false;

    const clearPoll = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    };
    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };
    const arm = (ms: number) => {
      clearWatchdog();
      watchdog = setTimeout(() => !stopped && startFallback(), ms);
    };

    const revoke = () => {
      stopped = true;
      es?.close();
      es = null;
      clearPoll();
      clearWatchdog();
      gen.current++; // drop every outstanding async result for this thread
      setMessages([]);
      setThreadState(null);
      setRevoked(true);
    };

    const poll = async () => {
      if (stopped) return;
      polls++;
      if (polls % RECONNECT_EVERY === 0 && typeof EventSource !== "undefined") {
        connect();
        return;
      }
      try {
        await catchUp(g, id);
        if (!stopped) setConnection("fallback");
      } catch (e) {
        if (stopped) return;
        if (isDenied(e)) return revoke();
        setConnection("offline");
      }
      if (!stopped) pollTimer = setTimeout(poll, FALLBACK_MS);
    };

    function startFallback() {
      es?.close();
      es = null;
      clearWatchdog();
      clearPoll();
      setConnection((c) => (c === "offline" ? c : "fallback"));
      pollTimer = setTimeout(poll, 0);
    }

    function connect() {
      if (stopped) return;
      clearPoll();
      setConnection((c) => (c === "live" ? c : "connecting"));
      try {
        es = new EventSource(
          `/api/support?threadId=${encodeURIComponent(id)}&after=${maxSeq.current}`,
          { withCredentials: true },
        );
      } catch {
        startFallback();
        return;
      }
      arm(READY_TIMEOUT_MS);
      es.addEventListener("ready", () => {
        if (stopped) return;
        clearWatchdog();
        polls = 0;
        wasLive = true;
        setConnection("live");
        void catchUp(g, id).catch(() => {}); // recover anything missed
      });
      es.addEventListener("update", (ev) => {
        if (stopped) return;
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            messages?: Message[];
            thread?: Thread;
          };
          const batch = data.messages ?? [];
          apply(g, id, batch, data.thread);
          if (batch.length >= SSE_BATCH_CAP) void catchUp(g, id).catch(() => {});
        } catch {
          /* malformed frame */
        }
      });
      es.addEventListener("revoked", revoke);
      es.onerror = () => {
        if (stopped || !es) return;
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          // Server rotates streams (~4 min): one immediate reconnect after a healthy stream.
          if (wasLive) {
            wasLive = false;
            connect();
          } else startFallback();
          return;
        }
        // Browser is auto-reconnecting (Last-Event-ID). Bound how long we wait for 'ready'.
        setConnection("connecting");
        if (!watchdog) arm(ERROR_GRACE_MS);
      };
    }

    if (typeof EventSource === "undefined") startFallback();
    else connect();

    const online = () => {
      if (!es && !stopped) connect();
    };
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      es?.close();
      clearPoll();
      clearWatchdog();
      window.removeEventListener("online", online);
    };
  }, [threadId, active, loading, error, revoked, apply, catchUp]);

  const loadOlder = useCallback(async () => {
    if (!threadId || loadingOlder || !hasMore || !messages.length) return;
    const g = gen.current;
    setLoadingOlder(true);
    try {
      const res = await supportApi.history(threadId, { before: messages[0]!.seq });
      if (!isCurrent(g, threadId)) return;
      setMessages((prev) => mergeMessages(prev, res.messages.filter((m) => m.thread_id === threadId)));
      setHasMore(res.hasMore);
    } catch {
      /* keep button for retry */
    } finally {
      if (isCurrent(g, threadId)) setLoadingOlder(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, loadingOlder, hasMore, messages]);

  return {
    messages,
    thread,
    setThread,
    hasMore,
    loading,
    loadingOlder,
    error,
    denied,
    revoked,
    connection,
    loadOlder,
    applyExternal,
    onIncoming,
    reload: () => setReloadKey((k) => k + 1),
  };
}
