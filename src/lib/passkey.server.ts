import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { query, queryOne, transaction, nowIso } from "./d1.server";
import { readSession, sessionState, sha256Hex, verifyPassword, publishPasskeySession } from "./guard.server";
import { binding, cleanExpired, config, digest, enabled, limitRequest, responseJSON, throttle } from "./passkey-policy.server";
import { measure } from "./observability.server";

type Member = { id: string; email: string; password_hash: string; session_id: string; created_at: string };
type Challenge = {
  id: string; challenge_hash: string; binding_hash: string; kind: string;
  user_id: string | null; session_id: string | null; credential_tag: string | null; remember: number;
};
type Credential = {
  id: string; user_id: string; public_key: string; counter: number; transports: string;
  credential_tag: string; email: string; password_hash: string;
};
// Same exclusion as password login, including the owner's configured representative.
const memberWhere = `p.deleted_at IS NULL AND p.frozen_at IS NULL AND p.is_verified=1
  AND NOT EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=p.id AND r.role='admin')
  AND lower(u.email) != ?`;
const ownerEmail = () => (process.env["ADMIN_EMAIL"] || "").trim().toLowerCase();

async function member(): Promise<Member> {
  const state = await sessionState();
  if (!state?.verified) throw new Error("Please sign in again to manage passkeys.");
  const row = await queryOne<Member>(`SELECT u.id,u.email,u.password_hash,s.id session_id,s.created_at
    FROM users u JOIN profiles p ON p.id=u.id JOIN sessions s ON s.user_id=u.id
    WHERE s.id=? AND s.expires_at>? AND ${memberWhere}`, [state.session_id, nowIso(), ownerEmail()]);
  if (!row) throw new Error("Passkeys are available only to active, verified members.");
  return row;
}
async function recent(password?: string) {
  const user = await member();
  await throttle("member:" + user.id, 10);
  if (Date.now() - Date.parse(user.created_at) > 300000) {
    if (!password || !await verifyPassword(password, user.password_hash))
      throw new Error("Confirm your current password, or sign in again, to manage passkeys.");
  }
  return user;
}
export async function status() {
  if (!enabled()) return { enabled: false, eligible: false, credentials: [] };
  config();
  const state = await sessionState();
  if (!state?.verified) return { enabled: true, eligible: false, credentials: [] };
  let user: Member;
  // Only authorization failure means ineligible; database errors must remain visible.
  const allowed = await queryOne(`SELECT p.id FROM profiles p JOIN users u ON u.id=p.id WHERE p.id=? AND ${memberWhere}`, [state.user_id, ownerEmail()]);
  if (!allowed) return { enabled: true, eligible: false, credentials: [] };
  user = await member();
  const credentials = await query<{id:string;name:string;created_at:string;last_used_at:string|null}>(
    "SELECT id,name,created_at,last_used_at FROM passkey_credentials WHERE user_id=? AND credential_tag=? ORDER BY created_at DESC LIMIT 10",
    [user.id, await sha256Hex(user.password_hash)]);
  return { enabled: true, eligible: true, sessionId: user.session_id, credentials,
    recent: Date.now() - Date.parse(user.created_at) <= 300000 };
}
async function saveChallenge(challenge: string, kind: "register" | "login", bound: string, remember = false, user?: Member) {
  const id = crypto.randomUUID();
  await query(`INSERT INTO passkey_challenges(id,challenge_hash,binding_hash,kind,user_id,session_id,credential_tag,remember,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?)`, [id, digest(challenge), bound, kind, user?.id ?? null, user?.session_id ?? null,
    user ? await sha256Hex(user.password_hash) : null, +remember, new Date(Date.now()+300000).toISOString()]);
  // Challenge itself is returned only to the browser; ID is embedded as an opaque extension via wrapper.
  await cleanExpired();
  return id;
}
export async function beginRegistration(password?: string) {
  const bound = await limitRequest();
  const user = await recent(password);
  const tag = await sha256Hex(user.password_hash);
  const existing = await query<{id:string}>("SELECT id FROM passkey_credentials WHERE user_id=? AND credential_tag=? LIMIT 10", [user.id,tag]);
  if (existing.length >= 10) throw new Error("You can save up to 10 passkeys. Remove one first.");
  const options = await generateRegistrationOptions({
    rpName: "ScousExchange", rpID: config().rpID, userName: user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: existing.map(c => ({ id: c.id })),
  });
  await saveChallenge(options.challenge, "register", bound, false, user);
  const { extensions: _unused, ...serializable } = options;
  return serializable;
}
/** Extract only to find the hashed challenge; the verifier validates all clientData fields. */
async function challengeFor(response: RegistrationResponseJSON | AuthenticationResponseJSON, kind: string) {
  responseJSON(response);
  try {
    if (typeof response.response.clientDataJSON !== "string" || response.response.clientDataJSON.length > 12000) throw Error();
    const client = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString());
    if (typeof client.challenge !== "string" || client.challenge.length > 200) throw Error();
    const row = await queryOne<Challenge>(`SELECT * FROM passkey_challenges
      WHERE challenge_hash=? AND binding_hash=? AND kind=? AND expires_at>? AND consumed IS NULL LIMIT 1`,
      [digest(client.challenge), binding(), kind, nowIso()]);
    if (!row) throw Error();
    return row;
  } catch { throw new Error("Passkey request expired or already used. Please retry."); }
}
async function measured<T>(fn:()=>Promise<T>):Promise<T> {
  const start = performance.now(); let ok = false;
  try { const value=await fn();ok=true;return value; }
  finally { measure("passkey", performance.now()-start, ok); }
}
export async function finishRegistration(input: unknown, name: string) {
  return measured(async () => {
    await limitRequest();
    const user = await member();
    const response = responseJSON(input) as RegistrationResponseJSON;
    const challenge = await challengeFor(response, "register");
    if (challenge.user_id !== user.id || challenge.session_id !== user.session_id ||
        challenge.credential_tag !== await sha256Hex(user.password_hash)) throw new Error("Sign in again to create a passkey.");
    let verified;
    try {
      verified = await verifyRegistrationResponse({ response,
        expectedChallenge: c => digest(c) === challenge.challenge_hash,
        expectedOrigin: config().origins, expectedRPID: config().rpID, requireUserVerification: true });
    } catch { throw new Error("Passkey verification failed. Retry or continue with password."); }
    if (!verified.verified || !verified.registrationInfo) throw new Error("Passkey verification failed.");
    const key = verified.registrationInfo.credential;
    const authenticatingKey = (await readSession()).data.passkeyId ?? null;
    const claim = crypto.randomUUID(), now = nowIso();
    const result = await transaction([
      {sql:"UPDATE passkey_challenges SET consumed=? WHERE id=? AND consumed IS NULL AND expires_at>? RETURNING id",
        params:[claim,challenge.id,now]},
      {sql:`INSERT INTO passkey_credentials(id,user_id,public_key,counter,transports,credential_tag,name,created_at)
        SELECT ?,u.id,?,?,?,?,?,? FROM users u JOIN profiles p ON p.id=u.id
        WHERE u.id=? AND u.password_hash=? AND ${memberWhere}
        AND EXISTS(SELECT 1 FROM sessions s JOIN session_security k ON k.session_id=s.id
          WHERE s.id=? AND s.user_id=u.id AND s.expires_at>? AND k.verified=1 AND k.credential_tag=?)
        AND (? IS NULL OR EXISTS(SELECT 1 FROM passkey_sessions ps JOIN passkey_credentials pc ON pc.id=ps.credential_id
          WHERE ps.session_id=? AND pc.id=? AND pc.user_id=u.id))
        AND EXISTS(SELECT 1 FROM passkey_challenges WHERE id=? AND consumed=?)
        AND (SELECT count(*) FROM passkey_credentials WHERE user_id=u.id AND credential_tag=?)<10
        RETURNING id`,
       params:[key.id, Buffer.from(key.publicKey).toString("base64url"),key.counter,JSON.stringify(key.transports||[]),
         challenge.credential_tag,name,now,user.id,user.password_hash,ownerEmail(),user.session_id,now,
         challenge.credential_tag,authenticatingKey,user.session_id,authenticatingKey,challenge.id,claim,challenge.credential_tag]},
    ]);
    if (!result[1]?.length) throw new Error("Your session changed or this request was used. Please retry.");
    return { ok: true as const };
  });
}
export async function beginLogin(remember: boolean) {
  const bound = await limitRequest();
  const options = await generateAuthenticationOptions({ rpID:config().rpID, userVerification:"required" });
  await saveChallenge(options.challenge,"login",bound,remember);
  const { extensions: _unused, ...serializable } = options;
  return serializable;
}
export async function finishLogin(input: unknown) {
  return measured(async () => {
    await limitRequest();
    const response = responseJSON(input) as AuthenticationResponseJSON;
    const challenge = await challengeFor(response,"login");
    if (typeof response.id !== "string" || response.id.length > 1500) throw new Error("Passkey sign-in failed.");
    const key = await queryOne<Credential>(`SELECT c.*,u.email,u.password_hash FROM passkey_credentials c
      JOIN users u ON u.id=c.user_id JOIN profiles p ON p.id=u.id
      WHERE c.id=? AND ${memberWhere}`, [response.id,ownerEmail()]);
    if (!key || key.credential_tag !== await sha256Hex(key.password_hash))
      throw new Error("Passkey sign-in failed. Continue with password.");
    if (response.response.userHandle !== Buffer.from(key.user_id).toString("base64url"))
      throw new Error("Passkey sign-in failed. Continue with password.");
    let verification;
    try {
      verification = await verifyAuthenticationResponse({ response,
        expectedChallenge:c=>digest(c)===challenge.challenge_hash,
        expectedOrigin:config().origins,expectedRPID:config().rpID,requireUserVerification:true,
        credential:{id:key.id,publicKey:new Uint8Array(Buffer.from(key.public_key,"base64url")),counter:key.counter} });
    } catch { throw new Error("Passkey verification failed. Retry or continue with password."); }
    if (!verification.verified) throw new Error("Passkey verification failed.");
    const now = nowIso(), id=crypto.randomUUID(), claim=crypto.randomUUID();
    const expires = new Date(Date.now()+(challenge.remember?30:1)*86400000).toISOString();
    const previous=(await readSession()).data.sessionId || "";
    const result = await transaction([
      {sql:"UPDATE passkey_challenges SET consumed=? WHERE id=? AND consumed IS NULL AND expires_at>? RETURNING id",
        params:[claim,challenge.id,now]},
      {sql:`INSERT INTO sessions(id,user_id,expires_at,created_at)
        SELECT ?,u.id,?,? FROM passkey_credentials c JOIN users u ON u.id=c.user_id JOIN profiles p ON p.id=u.id
        WHERE c.id=? AND c.counter=? AND c.credential_tag=? AND u.password_hash=? AND ${memberWhere}
        AND EXISTS(SELECT 1 FROM passkey_challenges WHERE id=? AND consumed=?) RETURNING id`,
        params:[id,expires,now,key.id,key.counter,key.credential_tag,key.password_hash,ownerEmail(),challenge.id,claim]},
      {sql:`INSERT INTO session_security(session_id,verified,remember,purpose,credential_tag)
        SELECT id,1,?,'login',? FROM sessions WHERE id=?`,params:[challenge.remember,key.credential_tag,id]},
      {sql:"INSERT INTO passkey_sessions(session_id,credential_id) SELECT id,? FROM sessions WHERE id=?",params:[key.id,id]},
      {sql:"UPDATE passkey_credentials SET counter=?,last_used_at=? WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE id=?)",
        params:[verification.authenticationInfo.newCounter,now,key.id,id]},
      {sql:"DELETE FROM sessions WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE id=?)",params:[previous,id]},
    ]);
    if (!result[1]?.length) throw new Error("Passkey request was used or your account changed. Please retry.");
    await publishPasskeySession({userId:key.user_id,email:key.email,sessionId:id,passkeyId:key.id},!!challenge.remember,expires);
    return {ok:true as const};
  });
}
export async function manage(data:{id:string;action:"rename"|"remove";name?:string|undefined;password?:string|undefined}) {
  await limitRequest();
  const user=await recent(data.password);
  if(data.action==="rename"&&!data.name)throw new Error("Enter a passkey name.");
  const owned = await queryOne("SELECT id FROM passkey_credentials WHERE id=? AND user_id=?", [data.id,user.id]);
  if(!owned)throw new Error("Passkey not found.");
  const current = (await readSession()).data;
  const auth = `EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN profiles p ON p.id=u.id
    JOIN session_security k ON k.session_id=s.id
    WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND k.verified=1 AND u.password_hash=? AND ${memberWhere}
    AND (? IS NULL OR EXISTS(SELECT 1 FROM passkey_sessions ps JOIN passkey_credentials pc ON pc.id=ps.credential_id
      WHERE ps.session_id=s.id AND pc.id=? AND pc.user_id=u.id)))`;
  const params=[user.session_id,user.id,nowIso(),user.password_hash,ownerEmail(),current.passkeyId??null,current.passkeyId??null];
  const result= data.action==="rename"
    ? await query("UPDATE passkey_credentials SET name=? WHERE id=? AND user_id=? AND "+auth+" RETURNING id",
      [data.name,data.id,user.id,...params])
    : await query("DELETE FROM passkey_credentials WHERE id=? AND user_id=? AND "+auth+" RETURNING id",
      [data.id,user.id,...params]);
  if(!result.length)throw new Error("Your session changed. Please sign in again.");
  // Guard checks the credential/session mapping on every passkey session request.
  const signedOut=data.action==="remove"&&current.passkeyId===data.id;
  if(signedOut)await (await import("./guard.server")).endSession();
  return {ok:true as const,signedOut};
}
