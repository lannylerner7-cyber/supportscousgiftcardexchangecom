/**
 * Card photos and chat images (server-only).
 *
 * Files live in the project's own R2 bucket and are never public: every upload
 * and every download goes through this app, which checks first that the person
 * asking owns the file or is an admin.
 */

function gatewayBase() {
  const base = process.env["CONNECTOR_GATEWAY_BASE_URL"] ?? "https://connector-gateway.lovable.dev";
  return `${base.replace(/\/$/, "")}/cloudflare/client/v4`;
}

function config() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const cfKey = process.env["CLOUDFLARE_API_KEY"];
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const bucket = process.env["R2_BUCKET"];
  if (!lovableKey || !cfKey || !accountId || !bucket) {
    throw new Error("File storage is not configured.");
  }
  return { lovableKey, cfKey, accountId, bucket };
}

function objectUrl(key: string) {
  const { accountId, bucket } = config();
  const safeKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${gatewayBase()}/accounts/${accountId}/r2/buckets/${bucket}/objects/${safeKey}`;
}

function authHeaders() {
  const { lovableKey, cfKey } = config();
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": cfKey,
  };
}

/** Store a file. Keys are always `<userId>/<tradeOrThread>/<uuid>.<ext>`. */
export async function putObject(key: string, body: ArrayBuffer, contentType: string) {
  const response = await fetch(objectUrl(key), {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": contentType },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`R2 upload failed [${response.status}]: ${text}`);
    throw new Error("The file could not be stored. Please try again.");
  }
  return { key };
}

/** Read a file back for an already-authorised viewer. */
export async function getObject(key: string) {
  const response = await fetch(objectUrl(key), { headers: authHeaders() });
  if (!response.ok) {
    const text = await response.text();
    console.error(`R2 download failed [${response.status}]: ${text}`);
    return null;
  }
  return {
    body: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function deleteObject(key: string) {
  const response = await fetch(objectUrl(key), { method: "DELETE", headers: authHeaders() });
  if (!response.ok) console.error(`R2 delete failed [${response.status}]: ${await response.text()}`);
}

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function checkImage(type: string, size: number) {
  if (!ALLOWED.has(type.toLowerCase())) return "Only JPG, PNG, WEBP or HEIC images are allowed.";
  if (size > MAX_IMAGE_BYTES) return "Each photo must be under 10MB.";
  return null;
}

export function extensionFor(type: string) {
  switch (type.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
    case "image/heif":
      return "heic";
    default:
      return "jpg";
  }
}
