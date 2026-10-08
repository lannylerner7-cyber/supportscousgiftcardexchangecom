import { checkImage, imageType } from "./image-validation";

export async function uploadTradePhoto(tradeId: string, file: File) {
  const problem = checkImage(imageType(file.type, file.name), file.size);
  if (problem) throw new Error(problem);
  const body = new FormData();
  body.append("tradeId", tradeId);
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.BASE_URL}api/uploads`, {
      method: "POST", body, signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error("Connection interrupted. Your trade is saved. Retry this same photo; it will not be added twice.");
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session expired. Sign in, then resume this trade from history.");
    if (response.status === 413) throw new Error("The upload was too large for the server. Choose a photo under 10MB or contact support.");
    const message = await response.text();
    if (response.headers.get("content-type")?.includes("text/plain") && message.length < 400)
      throw new Error(message);
    throw new Error("Photo upload could not be confirmed. Retry the same photo on this trade, not a new submission.");
  }
  const result = await response.json().catch(() => null) as { ok?: boolean; path?: string } | null;
  if (result?.ok !== true || typeof result.path !== "string") {
    throw new Error("The server did not confirm this photo. Retry it on this saved trade.");
  }
}
