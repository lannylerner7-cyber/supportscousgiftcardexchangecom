import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowDown,
  Check,
  CheckCheck,
  Clock,
  ImagePlus,
  Loader2,
  Lock,
  RefreshCw,
  SendHorizontal,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { fileUrl, presenceActive, supportApi, timeLabel, type Message, type Thread } from "./api";
import { useOutbox, type PendingItem } from "./outbox";
import { useConversation, type Connection } from "./useConversation";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Props = {
  threadId: string | null;
  userId: string | null;
  viewer: "user" | "admin";
  active?: boolean;
  className?: string | undefined;
  /** Rendered above the timeline (admin controls etc.). Receives the latest thread. */
  header?: (thread: Thread | null, setThread: (t: Thread) => void) => ReactNode;
  onThreadChange?: (t: Thread | null) => void;
};

export function Conversation({
  threadId,
  userId,
  viewer,
  active = true,
  className,
  header,
  onThreadChange,
}: Props) {
  const convo = useConversation(threadId, active);
  const { messages, thread, connection } = convo;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [newBelow, setNewBelow] = useState(0);
  const nearBottom = useRef(true);
  const initialScrolled = useRef<string | null>(null);

  const outbox = useOutbox(userId, threadId, (m, forThread) => {
    convo.applyExternal([m], forThread); // ignored if the thread changed meanwhile
    if (forThread === threadId) requestAnimationFrame(() => scrollToBottom("smooth"));
  });
  const confirmRef = useRef(outbox.confirm);
  confirmRef.current = outbox.confirm;

  const onThreadChangeRef = useRef(onThreadChange);
  onThreadChangeRef.current = onThreadChange;
  useEffect(() => {
    onThreadChangeRef.current?.(thread);
  }, [thread]);

  // Revoked: drop everything private, including local drafts in memory.
  useEffect(() => {
    if (convo.revoked) outbox.clearAll();
  }, [convo.revoked, outbox.clearAll]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setNewBelow(0);
  }, []);

  // Incoming live messages: confirm pending, stick to bottom only if already there.
  convo.onIncoming.current = (batch) => {
    confirmRef.current(batch.map((m) => m.id));
    if (initialScrolled.current !== threadId) return;
    const fresh = batch.filter((m) => m.sender_role !== viewer).length;
    if (nearBottom.current) requestAnimationFrame(() => scrollToBottom("smooth"));
    else if (fresh) setNewBelow((n) => n + fresh);
  };

  // Initial position: first unread incoming message, else bottom. Never jump later.
  useLayoutEffect(() => {
    if (convo.loading || initialScrolled.current === threadId || !scrollRef.current) return;
    initialScrolled.current = threadId;
    const myCursor = (viewer === "user" ? thread?.user_read : thread?.admin_read) ?? 0;
    const firstUnread = messages.find((m) => m.sender_role !== viewer && !m.read_at && m.seq > myCursor);
    const el = scrollRef.current;
    const total = (viewer === "user" ? thread?.unread_for_user : thread?.unread_for_admin) ?? 0;
    const loaded = messages.filter((m) => m.sender_role !== viewer && !m.read_at && m.seq > myCursor).length;
    if (convo.hasMore && total > loaded) {
      el.scrollTop = 0; // older unread exist beyond this page: start at the top so they load first
      return;
    }
    if (firstUnread) {
      const node = el.querySelector<HTMLElement>(`[data-msg-id="${firstUnread.id}"]`);
      if (node) {
        el.scrollTop = Math.max(0, node.offsetTop - 72);
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  }, [convo.loading, convo.hasMore, threadId, messages, viewer, thread]);

  // Older page: preserve the visual anchor.
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const loadOlder = () => {
    const el = scrollRef.current;
    if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    void convo.loadOlder();
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !anchor.current || convo.loadingOlder) return;
    el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
    anchor.current = null;
  }, [messages, convo.loadingOlder]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom.current && newBelow) setNewBelow(0);
    if (el.scrollTop < 40 && convo.hasMore && !convo.loadingOlder) loadOlder();
  };

  // Read cursors from the thread are authoritative (SSE replays only newer seq).
  const otherRead = (viewer === "user" ? thread?.admin_read : thread?.user_read) ?? 0;
  const myRead = (viewer === "user" ? thread?.user_read : thread?.admin_read) ?? 0;
  const isUnreadIncoming = (m: Message) => m.sender_role !== viewer && !m.read_at && m.seq > myRead;
  // Unread messages older than the loaded window: never mark through them.
  const totalUnread = (viewer === "user" ? thread?.unread_for_user : thread?.unread_for_admin) ?? 0;
  const loadedUnread = messages.filter(isUnreadIncoming).length;
  const hiddenUnread = convo.hasMore && totalUnread > loadedUnread ? totalUnread - loadedUnread : 0;
  const messageIds = useMemo(() => new Set(messages.map((m) => m.id)), [messages]);
  const pending = outbox.pending.filter((p) => !messageIds.has(p.id));
  useReadTracking({
    root: scrollRef,
    threadId,
    messages,
    viewer,
    myRead,
    blocked: hiddenUnread > 0,
    enabled: active && !convo.loading && !convo.revoked && !convo.error,
  });

  const presence = usePresenceClock(thread);
  const lastMine = [...messages].reverse().find((m) => m.sender_role === viewer);
  const lastAny = messages[messages.length - 1];
  const waiting =
    viewer === "user" &&
    (pending.length > 0 || (lastAny && lastAny.sender_role === "user")) &&
    !presence;

  if (!threadId && convo.loading) return <ConversationSkeleton className={className} />;

  if (convo.revoked || convo.denied) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center", className)}>
        <span className="bg-surface-2 flex h-11 w-11 items-center justify-center rounded-full">
          <Lock className="text-muted-foreground h-5 w-5" />
        </span>
        <p className="text-sm font-semibold" data-testid="status-chat-denied">
          {convo.revoked ? "Access to this conversation has ended" : "You cannot view this conversation"}
        </p>
        <p className="text-muted-foreground max-w-xs text-xs">
          {convo.revoked
            ? "Messages were cleared from this screen. Sign in again or reopen chat to continue."
            : convo.error?.message}
        </p>
        <button
          type="button"
          onClick={convo.reload}
          className="border-border mt-1 rounded-full border px-4 py-2 text-xs font-semibold"
          data-testid="button-chat-retry-access"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {header?.(thread, convo.setThread)}
      <ConnectionBar connection={connection} loading={convo.loading} />

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto overscroll-contain px-4 py-4"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Support conversation"
          data-testid="list-chat-messages"
        >
          {convo.loading ? (
            <TimelineSkeleton />
          ) : convo.error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="text-destructive h-6 w-6" />
              <p className="text-sm">{convo.error.message}</p>
              <button
                type="button"
                onClick={convo.reload}
                className="bg-gold-gradient text-primary-foreground flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold"
                data-testid="button-chat-reload"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {hiddenUnread > 0 && (
                <div
                  role="status"
                  className="border-primary/40 bg-primary/10 mb-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px]"
                  data-testid="status-earlier-unread"
                >
                  <span>
                    {hiddenUnread} earlier unread {hiddenUnread === 1 ? "message" : "messages"} above. They stay unread until you view them.
                  </span>
                  <button type="button" onClick={loadOlder} disabled={convo.loadingOlder} className="text-primary shrink-0 font-semibold">
                    Show
                  </button>
                </div>
              )}
              {convo.hasMore ? (
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={loadOlder}
                    disabled={convo.loadingOlder}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
                    data-testid="button-load-older"
                  >
                    {convo.loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
                    {convo.loadingOlder ? "Loading earlier messages" : "Load earlier messages"}
                  </button>
                </div>
              ) : (
                viewer === "user" && <AutoNotice>
                  Automatic message: this is your Scous support conversation. Messages stay in your
                  account so you can come back anytime. Replies from our team appear here.
                </AutoNotice>
              )}

              {!convo.hasMore && messages.length === 0 && pending.length === 0 && (
                <p className="text-muted-foreground py-6 text-center text-xs">
                  {viewer === "admin" ? "No messages in this thread yet." : "Start by describing what you need help with."}
                </p>
              )}

              {messages.map((m, i) => (
                <Bubble
                  key={m.id}
                  m={m}
                  mine={m.sender_role === viewer}
                  viewer={viewer}
                  grouped={i > 0 && messages[i - 1]?.sender_role === m.sender_role}
                  showSeen={m.id === lastMine?.id}
                  seen={!!m.read_at || m.seq <= otherRead}
                  unreadIncoming={isUnreadIncoming(m)}
                />
              ))}

              {pending.map((p) => (
                <PendingBubble
                  key={p.id}
                  p={p}
                  progress={outbox.progress[p.id]}
                  file={outbox.previewFile(p.attachmentId)}
                  onRetry={() => outbox.retry(p.id)}
                  onDiscard={() => outbox.discard(p.id)}
                  onDropImage={() => outbox.sendWithoutImage(p.id)}
                  onReattach={(f) => outbox.reattach(p.id, f)}
                />
              ))}

              {waiting && (
                <AutoNotice>
                  Automatic notice: your message is saved. No one from support is in this
                  conversation right now; replies will appear here and in your notifications.
                </AutoNotice>
              )}
            </div>
          )}
        </div>

        {newBelow > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="bg-gold-gradient text-primary-foreground animate-in fade-in slide-in-from-bottom-2 absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-lg"
            data-testid="button-new-messages"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {newBelow} new {newBelow === 1 ? "message" : "messages"}
          </button>
        )}
      </div>

      <Composer
        disabled={convo.loading || !!convo.error || !threadId}
        draft={outbox.draft}
        file={outbox.draftFile}
        setFile={outbox.setDraftFile}
        lostImage={outbox.lostDraftImage}
        onDismissLost={outbox.dismissLostDraftImage}
        setDraft={outbox.setDraft}
        onSend={(body, file) => {
          outbox.enqueue(body, file);
          requestAnimationFrame(() => scrollToBottom("smooth"));
        }}
        resolvedNote={
          thread?.resolved
            ? viewer === "admin"
              ? "Marked resolved. Sending a reply reopens it."
              : "This conversation was marked resolved. Sending a message reopens it."
            : null
        }
      />
    </div>
  );
}

/* ---------- read tracking ---------- */

function useReadTracking({
  root,
  threadId,
  messages,
  viewer,
  myRead,
  blocked,
  enabled,
}: {
  root: React.RefObject<HTMLDivElement | null>;
  threadId: string | null;
  messages: Message[];
  viewer: "user" | "admin";
  myRead: number;
  blocked: boolean;
  enabled: boolean;
}) {
  const visible = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const sent = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgsRef = useRef(messages);
  msgsRef.current = messages;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const myReadRef = useRef(myRead);
  myReadRef.current = myRead;

  useEffect(() => {
    visible.current.clear();
    seen.current.clear();
    sent.current = 0;
  }, [threadId]);

  const attentive = () =>
    typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();

  const flush = useCallback(() => {
    if (!threadId || !attentive() || blockedRef.current) return;
    // Re-check geometry on scroll/focus too: image decoding and browser focus
    // changes need not produce a new intersection-threshold callback.
    const viewport=root.current?.getBoundingClientRect();
    root.current?.querySelectorAll<HTMLElement>("[data-unread-incoming='true']").forEach(node=>{
      const r=node.getBoundingClientRect();
      const visibleHeight=viewport?Math.max(0,Math.min(r.bottom,viewport.bottom)-Math.max(r.top,viewport.top)):0;
      const id=node.dataset["msgId"]!;
      if(viewport&&visibleHeight>=Math.min(r.height,viewport.height)*0.6)visible.current.add(id);
      else visible.current.delete(id);
    });
    for (const id of visible.current) seen.current.add(id);
    // Highest seq such that every unread incoming message up to it has actually been seen.
    const unread = msgsRef.current.filter(
      (m) => m.sender_role !== viewer && !m.read_at && m.seq > myReadRef.current,
    );
    let target = 0;
    for (const m of unread) {
      if (!seen.current.has(m.id)) break;
      target = m.seq;
    }
    if (target > sent.current && target > myReadRef.current) {
      const prev = sent.current;
      sent.current = target;
      supportApi.read(threadId, target).catch(() => {
        sent.current = prev;
      });
    }
  }, [threadId, viewer,root]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  }, [flush]);

  useEffect(() => {
    const el = root.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset["msgId"]!;
          if (e.isIntersecting && e.intersectionRatio >= 0.6) visible.current.add(id);
          else visible.current.delete(id);
        }
        schedule();
      },
      { root: el, threshold: [0, 0.6, 1] },
    );
    el.querySelectorAll<HTMLElement>("[data-unread-incoming='true']").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [enabled, messages, blocked, myRead, root, schedule]);

  useEffect(() => {
    if (!enabled) return;
    const on = () => schedule();
    document.addEventListener("visibilitychange", on);
    document.addEventListener("focusin", on);
    window.addEventListener("focus", on);
    const el=root.current;
    el?.addEventListener("scroll",on,{passive:true});
    return () => {
      document.removeEventListener("visibilitychange", on);
      document.removeEventListener("focusin", on);
      window.removeEventListener("focus", on);
      el?.removeEventListener("scroll",on);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, schedule,root]);
}

/* ---------- pieces ---------- */

function usePresenceClock(thread: Thread | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!thread?.joined_until) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [thread?.joined_until]);
  return presenceActive(thread, now);
}

function AutoNotice({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto my-3 flex max-w-sm items-start gap-2 rounded-xl border border-dashed border-border/80 px-3 py-2.5">
      <Clock className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p className="text-muted-foreground text-[11px] leading-relaxed">{children}</p>
    </div>
  );
}

function ConnectionBar({ connection, loading }: { connection: Connection; loading: boolean }) {
  if (loading || connection === "live") return null;
  const map: Record<Exclude<Connection, "live">, { text: string; tone: string }> = {
    connecting: { text: "Connecting to live updates", tone: "text-muted-foreground" },
    fallback: { text: "Live updates paused. Checking for new messages every few seconds.", tone: "text-primary" },
    offline: { text: "Disconnected. Messages you send will wait here until you retry.", tone: "text-destructive" },
  };
  const s = map[connection];
  return (
    <div
      role="status"
      className={cn("border-border/60 bg-surface-2/60 flex items-center gap-2 border-b px-4 py-1.5 text-[11px]", s.tone)}
      data-testid="status-chat-connection"
    >
      {connection === "connecting" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <WifiOff className="h-3 w-3" />
      )}
      {s.text}
    </div>
  );
}

function Bubble({
  m,
  mine,
  viewer,
  grouped,
  showSeen,
  seen,
  unreadIncoming,
}: {
  m: Message;
  mine: boolean;
  viewer: "user" | "admin";
  grouped: boolean;
  showSeen: boolean;
  seen: boolean;
  unreadIncoming: boolean;
}) {
  const incomingUnread = unreadIncoming;
  const label = m.sender_role === "admin" ? (viewer === "admin" ? "Support (team)" : "Scous support") : viewer === "admin" ? "Member" : "You";
  return (
    <div
      data-msg-id={m.id}
      data-unread-incoming={incomingUnread ? "true" : undefined}
      className={cn("flex flex-col", mine ? "items-end" : "items-start", !grouped && "pt-2")}
      data-testid={`row-message-${m.id}`}
    >
      {!grouped && (
        <span className="text-muted-foreground mb-1 px-1 text-[10px] font-semibold tracking-wide uppercase">
          {label}
        </span>
      )}
      <div
        className={cn(
          "max-w-[82%] overflow-hidden rounded-2xl text-sm leading-relaxed",
          mine
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-surface-2 border-border/60 rounded-bl-md border",
        )}
      >
        {m.image_path && (
          <a href={fileUrl(m.image_path)} target="_blank" rel="noreferrer" className="block">
            <img
              src={fileUrl(m.image_path)}
              alt="Attached image"
              loading="lazy"
              className="max-h-64 w-full object-cover"
            />
          </a>
        )}
        {m.body && <p className="px-3.5 py-2 break-words whitespace-pre-wrap">{m.body}</p>}
      </div>
      <span className="text-muted-foreground mt-0.5 flex items-center gap-1 px-1 text-[10px]">
        {timeLabel(m.created_at)}
        {mine && showSeen && (
          seen ? (
            <>
              <CheckCheck className="text-primary h-3 w-3" /> Seen
            </>
          ) : (
            <>
              <Check className="h-3 w-3" /> Delivered
            </>
          )
        )}
      </span>
    </div>
  );
}

function PendingBubble({
  p,
  progress,
  file,
  onRetry,
  onDiscard,
  onDropImage,
  onReattach,
}: {
  p: PendingItem;
  progress?: number | undefined;
  file: File | null;
  onRetry: () => void;
  onDiscard: () => void;
  onDropImage: () => void;
  onReattach: (f: File) => void;
}) {
  const preview = useObjectUrl(file);
  const failed = p.status === "failed" || p.status === "needs-image";
  const reattachRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-end pt-2" data-testid={`row-pending-${p.id}`}>
      <div
        className={cn(
          "max-w-[82%] overflow-hidden rounded-2xl rounded-br-md text-sm leading-relaxed",
          failed
            ? "border-destructive/50 bg-destructive/10 border"
            : "bg-primary/70 text-primary-foreground",
        )}
      >
        {preview && <img src={preview} alt="Image being sent" className="max-h-48 w-full object-cover opacity-80" />}
        {!preview && p.imageName && (
          <p className="border-border/40 border-b px-3.5 py-1.5 text-[11px] opacity-80">Photo: {p.imageName}</p>
        )}
        {p.body && <p className="px-3.5 py-2 break-words whitespace-pre-wrap">{p.body}</p>}
        {p.status === "uploading" && (
          <div className="bg-primary-foreground/20 h-1 w-full">
            <div
              className="bg-primary-foreground h-full origin-left transition-transform"
              style={{ transform: `scaleX(${progress ?? 0})` }}
            />
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-end gap-2 px-1 text-[10px]">
        {!failed && (
          <span className="text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {p.status === "uploading" ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : "Sending"}
          </span>
        )}
        {failed && (
          <>
            <span className="text-destructive flex items-center gap-1" role="alert">
              <AlertCircle className="h-3 w-3" /> {p.error ?? "Not sent"}
            </span>
            {p.status === "needs-image" ? (
              <>
                <button type="button" onClick={() => reattachRef.current?.click()} className="text-primary font-semibold">
                  Reattach photo
                </button>
                <input
                  ref={reattachRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onReattach(f);
                    e.target.value = "";
                  }}
                />
                {p.body && (
                  <button type="button" onClick={onDropImage} className="text-primary font-semibold">
                    Send text only
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={onRetry}
                className="text-primary flex items-center gap-1 font-semibold"
                data-testid={`button-retry-${p.id}`}
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            )}
            <button
              type="button"
              onClick={onDiscard}
              className="text-muted-foreground flex items-center gap-1"
              aria-label="Remove unsent message and return text to the composer"
              data-testid={`button-discard-${p.id}`}
            >
              <Trash2 className="h-3 w-3" /> Edit
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

function Composer({
  disabled,
  draft,
  setDraft,
  file,
  setFile,
  lostImage,
  onDismissLost,
  onSend,
  resolvedNote,
}: {
  disabled: boolean;
  draft: string;
  setDraft: (s: string) => void;
  file: File | null;
  setFile: (f: File | null) => void;
  lostImage: string | null;
  onDismissLost: () => void;
  onSend: (body: string, file: File | null) => void;
  resolvedNote: string | null;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const preview = useObjectUrl(file);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !disabled && (draft.trim().length > 0 || !!file);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const submit = () => {
    if (!canSend) return;
    onSend(draft.trim(), file);
    setFile(null);
    ta.current?.focus();
  };

  const isTouch = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
    [],
  );

  return (
    <div className="border-border/70 bg-surface border-t px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {resolvedNote && <p className="text-muted-foreground px-1 pb-2 text-[11px]">{resolvedNote}</p>}
      {lostImage && !file && (
        <div role="alert" className="border-destructive/40 bg-destructive/10 mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px]" data-testid="status-lost-draft-image">
          <AlertCircle className="text-destructive mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            The photo you had attached ({lostImage}) was lost when the page reloaded. Your text is still here. Attach it again before sending.
          </span>
          <button type="button" onClick={onDismissLost} aria-label="Dismiss" className="text-muted-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {(preview || fileError) && (
        <div className="flex items-center gap-2 pb-2">
          {preview && (
            <div className="relative">
              <img src={preview} alt="Selected attachment" className="h-14 w-14 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label="Remove attached photo"
                className="bg-background border-border absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                data-testid="button-remove-attachment"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {fileError && <p className="text-destructive text-[11px]">{fileError}</p>}
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          aria-label="Attach a photo"
          className="text-muted-foreground hover:text-primary hover:bg-surface-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
          data-testid="button-attach-image"
        >
          <ImagePlus className="h-5 w-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (!f) return;
            if (!f.type.startsWith("image/")) return setFileError("Only images can be attached.");
            if (f.size > MAX_IMAGE_BYTES) return setFileError("That image is larger than 8 MB.");
            setFileError(null);
            setFile(f);
          }}
        />
        <label className="sr-only" htmlFor="support-composer">
          Message
        </label>
        <textarea
          id="support-composer"
          ref={ta}
          rows={1}
          value={draft}
          disabled={disabled}
          maxLength={4000}
          placeholder="Write a message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isTouch && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="border-border bg-surface-2 focus:border-primary/60 max-h-36 min-h-10 flex-1 resize-none rounded-2xl border px-3.5 py-2.5 text-sm outline-none transition-colors disabled:opacity-50"
          data-testid="input-chat-message"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className="bg-gold-gradient text-primary-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-40"
          data-testid="button-send-message"
        >
          <SendHorizontal className="h-4.5 w-4.5" />
        </button>
      </form>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4 py-2" aria-hidden>
      {[60, 40, 72, 52].map((w, i) => (
        <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
          <div className="bg-surface-2 h-10 animate-pulse rounded-2xl" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

export function ConversationSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div className={cn("flex flex-1 flex-col p-4", className)}>
      <TimelineSkeleton />
    </div>
  );
}
