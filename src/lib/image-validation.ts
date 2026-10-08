export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
export function imageType(type: string, name: string) {
  const value = type.toLowerCase();
  if (value && value !== "application/octet-stream") return value === "image/jpg" ? "image/jpeg" : value;
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    heic: "image/heic", heif: "image/heif" } as Record<string, string>)[extension ?? ""] ?? value;
}
export function checkImage(type: string, size: number) {
  if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(type))
    return "Choose a JPG, PNG, WEBP, HEIC or HEIF photo.";
  if (!size) return "This photo is empty.";
  if (size > MAX_IMAGE_BYTES) return "Each photo must be 10MB or smaller.";
  return null;
}
export function matchesImage(bytes: Uint8Array, type: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/png") return [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b);
  if (type === "image/webp") return ascii(0,4) === "RIFF" && ascii(8,12) === "WEBP";
  return ascii(4,8) === "ftyp" && /heic|heix|hevc|hevx|mif1|msf1/.test(ascii(8,Math.min(bytes.length,64)));
}
