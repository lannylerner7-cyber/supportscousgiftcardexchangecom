import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { requestOtp, verifyOtpCode } from "@/lib/auth.functions";

const ERRORS: Record<string, string> = {
  no_code: "That code has expired. Send a new one.",
  expired: "That code has expired. Send a new one.",
  attempts: "Too many wrong tries. Send a new code.",
  wrong: "Invalid OTP — check the code and try again.",
};

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function OtpForm({
  email,
  purpose,
  expiresAt,
  onVerified,
}: {
  email: string;
  purpose: "signup" | "login" | "reset" | "pin";
  expiresAt?: string | null;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(45);
  const [deadline, setDeadline] = useState<number | null>(
    expiresAt ? new Date(expiresAt).getTime() : null,
  );
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const left = useMemo(
    () => (deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : null),
    [deadline, now],
  );
  const expired = left !== null && left === 0;

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    const res = await verifyOtpCode({ data: { email, purpose, code: value } });
    setBusy(false);
    if (!res.ok) {
      setCode("");
      const message = ERRORS[res.error] ?? "Couldn't verify that code.";
      setError(message);
      toast.error(message);
      return;
    }
    onVerified();
  }

  async function resend() {
    setBusy(true);
    setError(null);
    const res = await requestOtp({ data: { email, purpose } });
    setBusy(false);
    if (!res.ok) {
      toast.error(
        res.error === "cooldown"
          ? `Hold on ${res.retryIn}s before asking for another code.`
          : "Too many codes requested. Try again later.",
      );
      setCooldown(res.retryIn ?? 60);
      return;
    }
    setCooldown(60);
    setCode("");
    setDeadline(new Date(res.expiresAt).getTime());
    toast.success("New code sent.");
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={code}
          disabled={expired}
          onChange={(v) => {
            setCode(v);
            setError(null);
            if (v.length === 6) void submit(v);
          }}
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} className="h-14 w-11 text-lg" />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      {left !== null && (
        <p
          className={
            expired
              ? "text-destructive text-center text-sm font-semibold"
              : "text-muted-foreground text-center text-sm"
          }
        >
          {expired ? "This code has expired — send a new one." : `Code expires in ${clock(left)}`}
        </p>
      )}

      {error && !expired && (
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-xl border px-4 py-3 text-center text-sm">
          {error}
        </p>
      )}

      {busy && (
        <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking…
        </p>
      )}

      <button
        type="button"
        onClick={resend}
        disabled={cooldown > 0 || busy}
        className="text-primary w-full text-center text-sm font-semibold disabled:opacity-50"
      >
        {cooldown > 0 ? `Resend code in ${cooldown}s` : "Send me a new code"}
      </button>
    </div>
  );
}
