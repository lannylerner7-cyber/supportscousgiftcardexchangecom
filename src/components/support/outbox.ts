import { useCallback, useEffect, useRef, useState } from "react";

import { SupportError, supportApi, uploadImage, uuid, type Message } from "./api";

/** Immutable once queued: id, body, attachmentId never change. */
export type PendingItem = {
  id: string;
  body: string;
  attachmentId: string | null;
  imagePath: string | null;
  imageName: string | null;
  status: "sending" | "uploading" | "failed" | "needs-image";
  error: string | null;
  createdAt: string;
};

type Stored = {
  draft: string;
  pending: PendingItem[];
  /** Name of the composer photo draft; the File itself is memory-only. */
  draftImageName?: string | null;
  /** Set when a photo draft existed but the page reload discarded the File. */
  lostDraftImage?: string | null;
};

/* Module-level store keyed by user+thread. Survives dialog unmount; every write
 * persists to sessionStorage for the captured key, never "whatever is current". */
const files = new Map<string, File>(); // attachmentId -> File (memory only)
const inflight = new Set<string>();
const draftFiles = new Map<string, File>(); // storage key -> composer photo draft
const cache = new Map<string, Stored>();
const listeners = new Map<string, Set<(s: Stored) => void>>();

function storageKey(userId: string, threadId: string) {
  return `scous-support:${userId}:${threadId}`;
}

function read(k: string): Stored {
  const hit = cache.get(k);
  if (hit) return hit;
  let s: Stored = { draft: "", pending: [] };
  try {
    const raw = sessionStorage.getItem(k);
    if (raw) {
      const parsed = JSON.parse(raw) as Stored;
      s = {
        draft: parsed.draft ?? "",
        draftImageName: null,
        lostDraftImage:
          parsed.draftImageName && !draftFiles.has(k) ? parsed.draftImageName : (parsed.lostDraftImage ?? null),
        pending: (parsed.pending ?? []).map((p) => {
          // A reload interrupted this item: surface it, never drop it.
          const lostFile = !!p.attachmentId && !p.imagePath && !files.has(p.attachmentId);
          return {
            ...p,
            status: lostFile ? "needs-image" : "failed",
            error: lostFile
              ? "The photo was lost when the page reloaded. Reattach it or send the text only."
              : (p.error ?? "Not confirmed as sent. Tap retry."),
          };
        }),
      };
    }
  } catch {
    /* storage disabled */
  }
  cache.set(k, s);
  return s;
}

function write(k: string, fn: (s: Stored) => Stored) {
  const next = fn(read(k));
  cache.set(k, next);
  try {
    sessionStorage.setItem(k, JSON.stringify(next));
  } catch {
    /* storage disabled */
  }
  listeners.get(k)?.forEach((l) => l(next));
}

function patchItem(k: string, id: string, p: Partial<PendingItem>) {
  write(k, (s) => ({ ...s, pending: s.pending.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}

const progressListeners = new Set<(id: string, f: number) => void>();

/** Runs with captured key + thread; safe after unmount or thread switch. */
async function run(
  k: string,
  threadId: string,
  item: PendingItem,
  onSent: (m: Message, threadId: string) => void,
) {
  if (inflight.has(item.id)) return;
  inflight.add(item.id);
  let imagePath = item.imagePath;
  try {
    if (item.attachmentId && !imagePath) {
      const file = files.get(item.attachmentId);
      if (!file) {
        patchItem(k, item.id, {
          status: "needs-image",
          error: "The photo is no longer available. Reattach it or send the text only.",
        });
        return;
      }
      patchItem(k, item.id, { status: "uploading", error: null });
      imagePath = await uploadImage(file, threadId, item.attachmentId, (f) =>
        progressListeners.forEach((l) => l(item.id, f)),
      );
      patchItem(k, item.id, { imagePath });
    }
    patchItem(k, item.id, { status: "sending", error: null });
    const { message } = await supportApi.send(threadId, item.id, item.body, imagePath ?? undefined);
    if (item.attachmentId) files.delete(item.attachmentId);
    write(k, (s) => ({ ...s, pending: s.pending.filter((x) => x.id !== item.id) }));
    onSent(message, threadId);
  } catch (e) {
    patchItem(k, item.id, {
      status: "failed",
      error: e instanceof SupportError ? e.message : "Message not sent.",
    });
  } finally {
    inflight.delete(item.id);
  }
}

export function useOutbox(
  userId: string | null,
  threadId: string | null,
  onSent: (m: Message, threadId: string) => void,
) {
  const k = userId && threadId ? storageKey(userId, threadId) : null;
  const [state, setState] = useState<Stored>(() => (k ? read(k) : { draft: "", pending: [] }));
  const [progress, setProgress] = useState<Record<string, number>>({});
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  // Stable trampoline: the in-flight send calls whatever handler is mounted now,
  // and that handler itself discards messages for a different thread.
  const sent = useCallback((m: Message, t: string) => onSentRef.current(m, t), []);

  useEffect(() => {
    if (!k) return setState({ draft: "", pending: [] });
    setState(read(k));
    let set = listeners.get(k);
    if (!set) listeners.set(k, (set = new Set()));
    const l = (s: Stored) => setState(s);
    set.add(l);
    return () => {
      set.delete(l);
    };
  }, [k]);

  useEffect(() => {
    const l = (id: string, f: number) => setProgress((p) => ({ ...p, [id]: f }));
    progressListeners.add(l);
    return () => {
      progressListeners.delete(l);
    };
  }, []);

  const find = (id: string) => (k ? read(k).pending.find((p) => p.id === id) : undefined);

  const setDraft = useCallback((draft: string) => k && write(k, (s) => ({ ...s, draft })), [k]);

  const setDraftFile = useCallback(
    (file: File | null) => {
      if (!k) return;
      if (file) draftFiles.set(k, file);
      else draftFiles.delete(k);
      write(k, (s) => ({ ...s, draftImageName: file?.name ?? null, lostDraftImage: null }));
    },
    [k],
  );

  const dismissLostDraftImage = useCallback(
    () => k && write(k, (s) => ({ ...s, lostDraftImage: null })),
    [k],
  );

  const enqueue = useCallback(
    (body: string, file: File | null) => {
      if (!k || !threadId) return;
      const attachmentId = file ? uuid() : null;
      if (file && attachmentId) files.set(attachmentId, file);
      const item: PendingItem = {
        id: uuid(),
        body,
        attachmentId,
        imagePath: null,
        imageName: file?.name ?? null,
        status: file ? "uploading" : "sending",
        error: null,
        createdAt: new Date().toISOString(),
      };
      draftFiles.delete(k);
      write(k, (s) => ({ draft: "", draftImageName: null, lostDraftImage: null, pending: [...s.pending, item] }));
      void run(k, threadId, item, sent);
    },
    [k, threadId, sent],
  );

  const retry = useCallback(
    (id: string) => {
      const item = find(id);
      if (k && threadId && item && item.status !== "needs-image") void run(k, threadId, item, sent);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k, threadId, sent],
  );

  /** Only for items that never reached send (photo lost). Content changes, so it gets a NEW id. */
  const sendWithoutImage = useCallback(
    (id: string) => {
      const item = find(id);
      if (!k || !threadId || !item || item.status !== "needs-image" || item.imagePath || !item.body)
        return;
      const next: PendingItem = {
        ...item,
        id: uuid(),
        attachmentId: null,
        imageName: null,
        status: "sending",
        error: null,
        createdAt: new Date().toISOString(),
      };
      write(k, (s) => ({ ...s, pending: s.pending.map((x) => (x.id === id ? next : x)) }));
      void run(k, threadId, next, sent);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k, threadId, sent],
  );

  const reattach = useCallback(
    (id: string, file: File) => {
      const item = find(id);
      if (!k || !threadId || !item?.attachmentId || item.status !== "needs-image") return;
      files.set(item.attachmentId, file);
      void run(k, threadId, item, sent);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k, threadId, sent],
  );

  const discard = useCallback(
    (id: string) => {
      const item = find(id);
      if (!k || !item || inflight.has(id)) return;
      if (item.attachmentId) files.delete(item.attachmentId);
      // Return the text to the composer so nothing is lost.
      write(k, (s) => ({
        ...s,
        draft: s.draft ? s.draft : item.body,
        pending: s.pending.filter((x) => x.id !== id),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k],
  );

  /** Server echoed these ids (SSE/history) — drop local copies that are not mid-request. */
  const confirm = useCallback(
    (ids: string[]) => {
      if (!k) return;
      const set = new Set(ids);
      if (!read(k).pending.some((p) => set.has(p.id) && !inflight.has(p.id))) return;
      write(k, (s) => ({ ...s, pending: s.pending.filter((p) => !set.has(p.id) || inflight.has(p.id)) }));
    },
    [k],
  );

  /** Access revoked: wipe private local state for this key. */
  const clearAll = useCallback(() => {
    if (!k) return;
    cache.delete(k);
    draftFiles.delete(k);
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    setState({ draft: "", pending: [] });
  }, [k]);

  return {
    draft: state.draft,
    draftFile: k ? (draftFiles.get(k) ?? null) : null,
    lostDraftImage: state.lostDraftImage ?? null,
    setDraftFile,
    dismissLostDraftImage,
    pending: state.pending,
    progress,
    setDraft,
    enqueue,
    retry,
    sendWithoutImage,
    reattach,
    discard,
    confirm,
    clearAll,
    previewFile: (attachmentId: string | null) =>
      attachmentId ? (files.get(attachmentId) ?? null) : null,
  };
}
