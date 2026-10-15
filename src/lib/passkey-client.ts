import { Capacitor } from "@capacitor/core";
import { nativePasskeyReady } from "./passkey-transport";

export type PasskeyCredential = { id: string; name: string; created_at: string; last_used_at: string | null };
export type PasskeyStatus = {
  enabled: boolean;
  eligible: boolean;
  sessionId?: string;
  credentials: PasskeyCredential[];
  recent?: boolean;
};

/** Scoped by user id so a different member on the same tab never sees stale data. */
export const passkeyStatusKey = (userId: string | null | undefined) => ["passkey-status", userId ?? "anon"] as const;

export type PasskeySupport = "ok" | "native" | "insecure" | "unsupported";

export function passkeySupport(): PasskeySupport {
  if (typeof window === "undefined") return "unsupported";
  try {
    if (Capacitor.isNativePlatform()) return nativePasskeyReady() ? "ok" : "native";
  } catch {
    /* Capacitor unavailable in plain browser builds. */
  }
  if (!window.isSecureContext) return "insecure";
  if (typeof window.PublicKeyCredential !== "function") return "unsupported";
  return "ok";
}

export function supportMessage(s: PasskeySupport): string | null {
  switch (s) {
    case "native":
      return "Passkeys are not available in the app yet. Use your password, or open Scous in your phone's browser.";
    case "insecure":
      return "Passkeys need a secure (https) connection. Use your password instead.";
    case "unsupported":
      return "This browser does not support passkeys. Use your password instead.";
    default:
      return null;
  }
}

export class PasskeyCancelled extends Error {}

/** Turn WebAuthn / server errors into short, member-safe messages. */
export function passkeyError(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string } | null;
  const name = e?.code || e?.name || "";
  if (err instanceof PasskeyCancelled || name === "NotAllowedError" || name === "AbortError" || e?.code === "ERROR_CEREMONY_ABORTED") {
    return "Passkey request was cancelled or timed out. You can try again.";
  }
  if (name === "InvalidStateError" || e?.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "This device already has a passkey for your account.";
  }
  if (name === "SecurityError") return "This site can't use passkeys on this connection.";
  if (name === "NotSupportedError") return "This device does not support the required passkey type.";
  const msg = e?.message?.trim();
  if (msg && msg.length < 200 && !/^\s*[{[]/.test(msg)) return msg;
  return "Something went wrong with the passkey. Please try again.";
}

export function isCancel(err: unknown) {
  const e = err as { name?: string; code?: string } | null;
  return err instanceof PasskeyCancelled || [e?.name, e?.code].some(
    name => name === "NotAllowedError" || name === "AbortError" || name === "ERROR_CEREMONY_ABORTED",
  );
}

const DISMISS_KEY = "scous.passkey-prompt-dismissed";
export function promptDismissed(sessionId?: string) {
  if (!sessionId) return false;
  try {
    return sessionStorage.getItem(DISMISS_KEY) === sessionId;
  } catch {
    return false;
  }
}
export function dismissPrompt(sessionId?: string) {
  if (!sessionId) return;
  try {
    sessionStorage.setItem(DISMISS_KEY, sessionId);
  } catch {
    /* storage disabled */
  }
}

/** Only allow internal member paths as post-login destinations. */
export function safeMemberReturn(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (!/^\/app(\/[A-Za-z0-9\-_/]*)?$/.test(v) || v.includes("//")) return undefined;
  return v;
}

export function defaultPasskeyName(): string {
  if (typeof navigator === "undefined") return "My passkey";
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return `${os}${br ? ` ${br}` : ""}`.slice(0, 60);
}

export function fmtDate(s: string | null) {
  if (!s) return "Never";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
