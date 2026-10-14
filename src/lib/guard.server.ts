/**
 * Who is asking? (server-only)
 *
 * D1 has no row-level security, so every read and write is authorised here.
 * The signed-in member is held in an encrypted, HttpOnly cookie; the admin
 * role is always read from the `user_roles` table, never from the cookie or
 * from anything the browser can set.
 */
import { useSession } from "@tanstack/react-start/server";

import { queryOne, execute, transaction, nowIso } from "./d1.server";

export type SessionData = { userId?: string; email?: string; sessionId?: string; passkeyId?: string };

const COOKIE_NAME = "scous_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

function sessionConfig(expires?: string) {
  const password = process.env["SESSION_SECRET"];
  if (!password) throw new Error("SESSION_SECRET is not configured");
  return {
    password,
    name: COOKIE_NAME,
    maxAge: MAX_AGE_S,
    // "none" + partitioned so the sign-in survives when the site is shown
    // inside another page (the editor preview); browsers drop "lax" cookies
    // there, which left members stuck on the code screen after verifying.
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none" as const,
      partitioned: true,
      path: "/",
      // Override h3's default persistent expiry for non-remembered sessions.
      ...({ expires: expires ? new Date(expires) : undefined } as { expires?: Date }),
    },
  };
}

export async function readSession() {
  const session = await useSession<SessionData>(sessionConfig());
  return session;
}

/** Only publish cookies after the passkey challenge and session transaction commits. */
export async function publishPasskeySession(data: Required<SessionData>, remember: boolean, expires: string) {
  const previous = await readSession();
  await previous.clear();
  const session = await useSession<SessionData>(sessionConfig(remember ? expires : undefined));
  await session.update(data);
}

/** Internal only. Password login must explicitly request a pending session. */
export async function startSession(userId: string, email: string, options: {
  verified?: boolean; remember?: boolean; purpose?: "login" | "signup";
  credentialTag?: string; expires?: string; challengeId?: string; fromSessionId?: string;
} = {}) {
  const user = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=?", [userId]);
  if (!user) throw new Error("Account unavailable.");
  if (options.credentialTag && options.credentialTag !== await sha256Hex(user.password_hash))
    throw new Error("Credentials changed. Please sign in again.");
  const verified = options.verified ?? true;
  const expires = options.expires ?? new Date(Date.now() + (verified ? (options.remember ? MAX_AGE_S : 86400) : 900) * 1000).toISOString();
  const id = crypto.randomUUID();
  const previous = await readSession();
  await transaction([
    {sql:`INSERT INTO sessions (id,user_id,expires_at,created_at)
      SELECT ?,p.id,?,? FROM profiles p JOIN users u ON u.id=p.id
      WHERE p.id=? AND p.deleted_at IS NULL AND u.password_hash=?
        AND (? IS NULL OR EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=p.id AND expires_at>?))`,
      params:[id, expires, nowIso(), userId,user.password_hash,
        options.fromSessionId ?? null, options.fromSessionId ?? null, nowIso()]},
    {sql:`INSERT INTO session_security(session_id,verified,remember,purpose,credential_tag,challenge_id)
      SELECT id,?,?,?,?,? FROM sessions WHERE id=?`,
      params:[Number(verified), Number(!!options.remember), options.purpose ?? "login",
        options.credentialTag ?? await sha256Hex(user.password_hash), options.challengeId ?? null, id]},
    {sql:"DELETE FROM sessions WHERE id=?",params:[previous.data.sessionId ?? ""]},
  ]);
  if (!await queryOne("SELECT id FROM sessions WHERE id=?", [id]))
    throw new Error("This account is inactive. Contact support to request reactivation.");
  await previous.clear();
  const session = await useSession<SessionData>(sessionConfig(verified && options.remember ? expires : undefined));
  await session.update({ userId, email, sessionId:id });
}

export async function endSession() {
  const { forgetDevice } = await import("./trusted-device.server");
  await forgetDevice();
  const session = await readSession();
  if (session.data.sessionId) await execute("DELETE FROM sessions WHERE id=?", [session.data.sessionId]);
  await session.clear();
}

/** Signed-in member id, or null. */
export async function sessionState(signal?:AbortSignal) {
  const session = await readSession();
  if (!session.data.userId || !session.data.sessionId) return null;
  const active = await queryOne<{
    user_id: string; email: string; session_id: string; verified: number;
    remember: number; purpose: string; credential_tag: string; password_hash: string;
    challenge_id: string | null;
  }>(`SELECT s.user_id,u.email,k.*,u.password_hash FROM sessions s
    JOIN profiles p ON p.id=s.user_id
    JOIN users u ON u.id=s.user_id
    JOIN session_security k ON k.session_id=s.id
    WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND p.deleted_at IS NULL`,
    [session.data.sessionId, session.data.userId, nowIso()],signal);
  if (!active || active.credential_tag !== await sha256Hex(active.password_hash)) return null;
  if (session.data.passkeyId) {
    if (process.env["PASSKEY_ENABLED"] !== "true") return null;
    const valid = await queryOne(`SELECT c.id FROM passkey_sessions ps
      JOIN passkey_credentials c ON c.id=ps.credential_id JOIN profiles p ON p.id=c.user_id
      WHERE ps.session_id=? AND c.id=? AND c.user_id=? AND c.credential_tag=?
        AND p.deleted_at IS NULL AND p.frozen_at IS NULL AND p.is_verified=1
        AND NOT EXISTS(SELECT 1 FROM user_roles WHERE user_id=p.id AND role='admin')
        AND lower(p.email)!=?`,
      [session.data.sessionId,session.data.passkeyId,active.user_id,active.credential_tag,
        (process.env["ADMIN_EMAIL"]||"").trim().toLowerCase()],signal);
    if (!valid) return null;
  }
  return active;
}

/** Signed-in member id, or null. */
export async function currentUserId(signal?:AbortSignal): Promise<string | null> {
  const state = await sessionState(signal);
  return state?.verified === 1 ? state.user_id : null;
}

export async function pendingSession(email: string, purpose: "login" | "signup") {
  const state = await sessionState();
  if (!state || state.verified || state.email !== email || state.purpose !== purpose) {
    throw new Error("Your verification session has ended. Please start again.");
  }
  return state;
}

export async function finishVerification(email: string, purpose: "login" | "signup") {
  const pending = await pendingSession(email, purpose);
  await startSession(pending.user_id, email, {
    verified: true, remember: !!pending.remember,
    credentialTag: pending.credential_tag, fromSessionId: pending.session_id,
  });
  if (pending.remember) {
    const { rememberDevice } = await import("./trusted-device.server");
    await rememberDevice(pending.user_id, pending.credential_tag, (await readSession()).data.sessionId!);
  }
}

export async function revokeUserAccess(userId: string) {
  await transaction([
    {sql:"DELETE FROM trusted_devices WHERE user_id=?",params:[userId]},
    {sql:"DELETE FROM sessions WHERE user_id=?",params:[userId]},
  ]);
}

export async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Please log in to continue.");
  return userId;
}

export async function isAdmin(userId: string,signal?:AbortSignal): Promise<boolean> {
  const row = await queryOne<{ role: string }>(
    "SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin' LIMIT 1",
    [userId],signal,
  );
  return Boolean(row);
}

/** Signed-in member id, but only when they really hold the admin role. */
export async function requireAdminId(): Promise<string> {
  const userId = await requireUserId();
  if (!(await isAdmin(userId))) throw new Error("You do not have access to this area.");
  return userId;
}

/* ----------------------------------------------------------- passwords */

// The live server's built-in PBKDF2 refuses more than 100,000 rounds.
const PBKDF2_ITERATIONS = 100_000;
const NATIVE_MAX_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  if (iterations > NATIVE_MAX_ITERATIONS) {
    // Older accounts were hashed with 120,000 rounds; check those in plain JS.
    const { pbkdf2Async } = await import("@noble/hashes/pbkdf2.js");
    const { sha256 } = await import("@noble/hashes/sha2.js");
    return pbkdf2Async(sha256, new TextEncoder().encode(password), salt, { c: iterations, dkLen: 32 });
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = fromHex(parts[2]!);
  const expected = parts[3]!;
  const actual = toHex(await derive(password, salt, iterations));
  return timingSafeEqual(actual, expected);
}

/** Constant-time string compare for hex digests. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}
