/** Android attestation origins are certificate-bound, not HTTP request origins. */
export function androidPasskeyOrigins(value = ""): string[] {
  if (!value.trim()) return [];
  const origins = [...new Set(value.split(",").map(s => s.trim()))];
  if (origins.some(s => !/^android:apk-key-hash:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(s))) {
    throw new Error("Passkey Android origin configuration is invalid.");
  }
  return origins;
}
