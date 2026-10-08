export type Thread = {
  id: string;
  user_id: string;
  full_name: string | null;
  last_message_at: string | null;
  unread_for_admin: number;
  unread_for_user: number;
  resolved: number;
  joined_until: string | null;
  user_read?: number;
  admin_read?: number;
  cursor?: number;
};

export type Message = {
  id: string;
  seq: number;
  thread_id: string;
  sender_id: string;
  sender_role: "user" | "admin";
  body: string | null;
  image_path: string | null;
  read_at: string | null;
  created_at: string;
};

export class SupportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function isDenied(e: unknown) {
  return e instanceof SupportError && (e.status === 401 || e.status === 403);
}

function friendly(status: number, text: string) {
  if (status === 401) return "Your session has ended. Sign in again to continue.";
  if (status === 403) return "You do not have access to this conversation.";
  if (status === 404) return "This conversation could not be found.";
  if (status === 413) return "That file is too large.";
  if (status === 429) return "Too many requests. Please wait a moment.";
  const t = text.trim();
  if (t && t.length < 160 && !t.startsWith("<")) return t;
  return "Something went wrong. Please try again.";
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/support", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SupportError(0, "You appear to be offline. Check your connection.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SupportError(res.status, friendly(res.status, text));
  }
  return (await res.json()) as T;
}

export const supportApi = {
  open: () => call<{ thread: Thread }>({ action: "open" }),
  list: (before?: number) => call<{ threads: Thread[]; hasMore: boolean }>({ action: "list", before }),
  history: (threadId: string, opts: { before?: number; after?: number } = {}) =>
    call<{ messages: Message[]; hasMore: boolean; thread: Thread }>({
      action: "history",
      threadId,
      ...opts,
    }),
  send: (threadId: string, id: string, body: string, imagePath?: string) =>
    call<{ message: Message }>({ action: "send", threadId, id, body, imagePath }),
  read: (threadId: string, seq: number) => call<{ ok: true }>({ action: "read", threadId, seq }),
  join: (threadId: string) => call<{ thread?: Thread }>({ action: "join", threadId }),
  resolve: (threadId: string, resolved: boolean) =>
    call<{ thread?: Thread }>({ action: "resolve", threadId, resolved }),
  summary: () => call<{ unread: number }>({ action: "summary" }),
  diagnostics: () => call<{ pending: number; exhausted: number }>({ action: "diagnostics" }),
};

export function fileUrl(path: string) {
  return `/api/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** XHR upload so we can report progress. Retry with the same attachmentId. */
export function uploadImage(
  file: File,
  threadId: string,
  attachmentId: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText) as { ok?: boolean; path?: string };
          if (json.ok && json.path) return resolve(json.path);
        } catch {
          /* fall through */
        }
        reject(new SupportError(xhr.status, "The upload did not complete."));
      } else {
        reject(new SupportError(xhr.status, friendly(xhr.status, xhr.responseText ?? "")));
      }
    };
    xhr.onerror = () => reject(new SupportError(0, "Upload failed. Check your connection."));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("threadId", threadId);
    fd.append("attachmentId", attachmentId);
    xhr.send(fd);
  });
}

export function timeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function presenceActive(thread: Thread | null | undefined, now = Date.now()) {
  if (!thread?.joined_until) return false;
  return new Date(thread.joined_until).getTime() > now;
}
