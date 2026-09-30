/**
 * Who is asking? (server-only)
 *
 * D1 has no row-level security, so every read and write is authorised here.
 * The signed-in member is held in an encrypted, HttpOnly cookie; the admin
 * role is always read from the `user_roles` table, never from the cookie or
 * from anything the browser can set.
 */
import { useSession } from "@tanstack/react-start/server";

import { queryOne } from "./d1.server";

export type SessionData = { userId?: string; email?: string };

const COOKIE_NAME = "scous_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

function sessionConfig() {
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
    },
  };
}

export async function readSession() {
  const session = await useSession<SessionData>(sessionConfig());
  return session;
}

export async function startSession(userId: string, email: string) {
  const session = await readSession();
  await session.update({ userId, email });
}

export async function endSession() {
  const session = await readSession();
  await session.clear();
}

/** Signed-in member id, or null. */
export async function currentUserId(): Promise<string | null> {
  const session = await readSession();
  return session.data.userId ?? null;
}

export async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Please log in to continue.");
  return userId;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const row = await queryOne<{ role: string }>(
    "SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin' LIMIT 1",
    [userId],
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

const PBKDF2_ITERATIONS = 120_000;

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
