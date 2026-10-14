import { useState } from "react";
import { Fingerprint, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { useIsAdmin } from "@/hooks/useAuth";
import { PasswordInput } from "@/components/PasswordInput";
import { defaultPasskeyName, dismissPrompt, isCancel, passkeyError, passkeySupport, promptDismissed } from "@/lib/passkey-client";
import { useEnrollPasskey, usePasskeyStatus } from "./usePasskeyStatus";

/** Gentle, dismissible card. Never starts WebAuthn until the member taps. */
export function PasskeyPrompt() {
  const { isAdmin } = useIsAdmin();
  const status = usePasskeyStatus();
  const enroll = useEnrollPasskey();
  const [hidden, setHidden] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const s = status.data;
  if (hidden || isAdmin || !s || !s.enabled || !s.eligible || s.credentials.length > 0) return null;
  if (promptDismissed(s.sessionId) || passkeySupport() !== "ok") return null;
  const needPw = !s.recent;

  function close() {
    dismissPrompt(s?.sessionId);
    setHidden(true);
  }

  function go() {
    if (enroll.isPending) return;
    setError(null);
    enroll.mutate(
      { name: defaultPasskeyName(), password: needPw ? password : undefined },
      {
        onSuccess: () => {
          toast.success("Passkey added. Your password still works too.");
          setHidden(true);
        },
        onError: (e) => setError(passkeyError(e) + (isCancel(e) ? "" : "")),
      },
    );
  }

  return (
    <div className="border-primary/40 bg-primary/10 relative mb-5 rounded-2xl border p-4" data-testid="card-passkey-prompt">
      <button type="button" onClick={close} aria-label="Not now" className="text-muted-foreground absolute top-3 right-3" data-testid="button-dismiss-passkey">
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3 pr-6">
        <span className="bg-gold-gradient text-primary-foreground grid h-10 w-10 shrink-0 place-items-center rounded-xl">
          <Fingerprint className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-semibold">Log in faster with a passkey</p>
            <p className="text-muted-foreground text-xs">
              Use your fingerprint, face or screen lock on this device. Optional — your password and email codes keep working.
            </p>
          </div>
          {needPw && (
            <PasswordInput id="passkey-prompt-pw" autoComplete="current-password" placeholder="Confirm your password"
              value={password} onChange={setPassword} />
          )}
          {error && <p className="text-destructive text-xs" role="alert">{error}</p>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={go} disabled={enroll.isPending || (needPw && !password)}
              className="bg-gold-gradient text-primary-foreground flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50"
              data-testid="button-add-passkey-prompt">
              {enroll.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {error ? "Try again" : "Set up passkey"}
            </button>
            <button type="button" onClick={close} className="text-muted-foreground text-xs font-semibold">Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}
