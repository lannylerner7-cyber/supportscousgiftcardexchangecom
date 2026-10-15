import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Fingerprint, KeyRound, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/hooks/useAuth";
import { PasswordInput } from "@/components/PasswordInput";
import { changePasskey } from "@/lib/passkey.functions";
import {
  defaultPasskeyName, fmtDate, passkeyError, passkeyStatusKey, passkeySupport, supportMessage,
  type PasskeyCredential,
} from "@/lib/passkey-client";
import { useEnrollPasskey, usePasskeyStatus } from "./usePasskeyStatus";

const field = "border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm";

export function PasskeySettings() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();
  const status = usePasskeyStatus();
  const enroll = useEnrollPasskey();
  const [password, setPassword] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<PasskeyCredential | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (v: { id: string; action: "rename" | "remove"; name?: string }) =>
      changePasskey({ data: { ...v, ...(needPw && password ? { password } : {}) } }),
    onSuccess: async (res, v) => {
      setError(null);
      if (res.signedOut) {
        toast.message("That passkey signed this session in, so you have been logged out.");
        await qc.cancelQueries();
        qc.clear();
        void navigate({ to: "/login", replace: true });
        return;
      }
      toast.success(v.action === "remove" ? "Passkey removed" : "Passkey renamed");
      setEditing(null);
      setConfirmRemove(null);
    },
    onError: (e) => setError(passkeyError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: passkeyStatusKey(user?.id) }),
  });

  const s = status.data;
  const needPw = !!s && !s.recent;
  const support = passkeySupport();
  const unsupported = supportMessage(support);
  const busy = enroll.isPending || change.isPending;

  function add() {
    if (busy) return;
    setError(null);
    enroll.mutate(
      { name: newName || defaultPasskeyName(), password: needPw ? password : undefined },
      {
        onSuccess: () => { toast.success("Passkey added"); setAdding(false); setNewName(""); },
        onError: (e) => setError(passkeyError(e)),
      },
    );
  }

  return (
    <section className="border-border/70 bg-surface space-y-3 rounded-2xl border p-5" data-testid="section-passkeys">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fingerprint className="text-primary h-4 w-4" />
          <p className="text-sm font-semibold">Passkeys</p>
        </div>
        {s?.enabled && s.eligible && !adding && !unsupported && (
          <button type="button" onClick={() => { setAdding(true); setNewName(defaultPasskeyName()); }}
            className="text-primary flex items-center gap-1 text-xs font-semibold" data-testid="button-open-add-passkey">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Log in with your device's fingerprint, face or screen lock. Your password and email codes always remain available as a backup.
      </p>

      {status.isLoading && (
        <div className="space-y-2">
          <div className="bg-surface-2 h-14 animate-pulse rounded-xl" />
          <div className="bg-surface-2 h-14 animate-pulse rounded-xl opacity-60" />
        </div>
      )}
      {status.isError && (
        <div className="text-destructive flex items-center justify-between text-xs">
          Couldn't load your passkeys.
          <button type="button" onClick={() => void status.refetch()} className="font-semibold underline">Retry</button>
        </div>
      )}
      {s && !s.enabled && (
        <p className="bg-surface-2 text-muted-foreground rounded-xl px-3 py-3 text-xs">Passkeys are not enabled yet. Check back soon.</p>
      )}
      {s?.enabled && !s.eligible && (
        <p className="bg-surface-2 text-muted-foreground rounded-xl px-3 py-3 text-xs">Passkeys are available to verified member accounts.</p>
      )}

      {s?.enabled && (
        <>
          {unsupported && s.eligible && (
            <p className="bg-surface-2 text-muted-foreground rounded-xl px-3 py-3 text-xs">{unsupported}</p>
          )}

          {needPw && (adding || editing || confirmRemove) && (
            <div className="space-y-1">
              <PasswordInput id="passkey-reauth" autoComplete="current-password" placeholder="Confirm your password"
                value={password} onChange={setPassword} />
              <p className="text-muted-foreground text-[11px]">For your security, confirm your password to change passkeys.</p>
            </div>
          )}

          {adding && (
            <div className="border-border/70 space-y-2 rounded-xl border p-3">
              <input className={field} maxLength={60} placeholder="Name, e.g. My iPhone" value={newName}
                onChange={(e) => setNewName(e.target.value)} data-testid="input-passkey-name" />
              <div className="flex gap-2">
                <button type="button" onClick={add} disabled={busy || (needPw && !password)}
                  className="bg-gold-gradient text-primary-foreground flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-50"
                  data-testid="button-add-passkey">
                  {enroll.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {enroll.isPending ? "Waiting for your device" : "Create passkey"}
                </button>
                <button type="button" onClick={() => { setAdding(false); setError(null); }} disabled={enroll.isPending}
                  className="border-border rounded-full border px-4 text-xs font-semibold">Cancel</button>
              </div>
            </div>
          )}

          {error && <p className="text-destructive text-xs" role="alert">{error}</p>}

          <ul className="space-y-2">
            {s.credentials.map((c) => (
              <li key={c.id} className="border-border/70 bg-surface-2 rounded-xl border p-3" data-testid={`row-passkey-${c.id}`}>
                {editing === c.id ? (
                  <div className="flex items-center gap-2">
                    <input className={field} maxLength={60} value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                    <button type="button" aria-label="Save name" disabled={busy || !editName.trim() || (needPw && !password)}
                      onClick={() => change.mutate({ id: c.id, action: "rename", name: editName.trim() })}
                      className="text-primary disabled:opacity-40">
                      {change.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button type="button" aria-label="Cancel rename" onClick={() => setEditing(null)} className="text-muted-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <KeyRound className="text-primary h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.name}</p>
                        <p className="text-muted-foreground text-[11px]">Added {fmtDate(c.created_at)} · Last used {fmtDate(c.last_used_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button type="button" aria-label="Rename passkey" disabled={busy}
                        onClick={() => { setEditing(c.id); setEditName(c.name); setConfirmRemove(null); setError(null); }}
                        className="text-muted-foreground"><Pencil className="h-4 w-4" /></button>
                      <button type="button" aria-label="Remove passkey" disabled={busy}
                        onClick={() => { setConfirmRemove(c); setEditing(null); setError(null); }}
                        className="text-destructive"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                )}
                {confirmRemove?.id === c.id && (
                  <div className="border-destructive/40 bg-destructive/10 mt-3 space-y-2 rounded-xl border p-3">
                    <p className="text-destructive text-xs font-semibold">Remove "{c.name}"?</p>
                    <p className="text-muted-foreground text-xs">
                      Any session signed in with this passkey is revoked immediately — including this one if you used it. You can always log back in with your password and email code.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy || (needPw && !password)}
                        onClick={() => change.mutate({ id: c.id, action: "remove" })}
                        className="bg-destructive text-destructive-foreground flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50"
                        data-testid={`button-confirm-remove-${c.id}`}>
                        {change.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Remove passkey
                      </button>
                      <button type="button" onClick={() => setConfirmRemove(null)} className="text-muted-foreground text-xs font-semibold">Keep it</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {s.eligible && s.credentials.length === 0 && !adding && (
            <p className="text-muted-foreground text-sm">No passkeys yet.</p>
          )}
        </>
      )}
    </section>
  );
}
