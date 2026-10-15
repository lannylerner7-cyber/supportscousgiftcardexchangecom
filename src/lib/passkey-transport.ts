import { Capacitor } from "@capacitor/core";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

// Deliberate release gate: this is not enabled until signed device verification.
export function nativePasskeyReady() {
  return import.meta.env["VITE_NATIVE_PASSKEY_ENABLED"] === "true"
    && Capacitor.isPluginAvailable("CapacitorPasskey");
}

function descriptors(values: { id: string; type: string; transports?: string[] }[]) {
  return values.map(value => {
    if (value.type !== "public-key") throw new Error("Unsupported credential type.");
    return { ...value, type: "public-key" as const };
  });
}

async function nativeBridge() {
  if (!nativePasskeyReady()) throw new Error("Passkeys are not enabled in this app. Use your password instead.");
  const { CapacitorPasskey } = await import("@capgo/capacitor-passkey");
  const support = await CapacitorPasskey.isSupported();
  if (!support.available) throw new Error("This device cannot use passkeys. Use your password instead.");
  const configuration = await CapacitorPasskey.getConfiguration();
  // Never take an RP origin from navigation, a request, or local storage.
  if (configuration.origin !== "https://scousgiftcardexchange.com") {
    throw new Error("Passkeys are not configured for this app. Use your password instead.");
  }
  return { bridge: CapacitorPasskey, origin: configuration.origin };
}

export async function registerPasskey(optionsJSON: Parameters<typeof startRegistration>[0]["optionsJSON"]) {
  if (!Capacitor.isNativePlatform()) return startRegistration({ optionsJSON });
  const { bridge, origin } = await nativeBridge();
  const { excludeCredentials, extensions, ...options } = optionsJSON;
  return bridge.createCredential({
    publicKey: {
      ...options,
      ...(extensions ? { extensions: { ...extensions } } : {}),
      ...(excludeCredentials ? { excludeCredentials: descriptors(excludeCredentials) } : {}),
    },
    origin,
  });
}

export async function authenticatePasskey(optionsJSON: Parameters<typeof startAuthentication>[0]["optionsJSON"]) {
  if (!Capacitor.isNativePlatform()) return startAuthentication({ optionsJSON });
  const { bridge, origin } = await nativeBridge();
  const { allowCredentials, extensions, ...options } = optionsJSON;
  return bridge.getCredential({
    // The installed bridge uses this property's presence to select its
    // authentication converter. Keep explicit, user-initiated mediation.
    mediation: "required",
    publicKey: {
      ...options,
      ...(extensions ? { extensions: { ...extensions } } : {}),
      ...(allowCredentials ? { allowCredentials: descriptors(allowCredentials) } : {}),
    },
    origin,
  });
}
