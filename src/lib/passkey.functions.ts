import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const proof = z.string().max(200).optional();
export const passkeyStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { status } = await import("./passkey.server");
  return status();
});
export const beginPasskeyRegistration = createServerFn({ method: "POST" })
  .inputValidator((d: { password?: string }) => z.object({ password: proof }).parse(d))
  .handler(async ({ data }) => (await import("./passkey.server")).beginRegistration(data.password));
export const finishPasskeyRegistration = createServerFn({ method: "POST" })
  .inputValidator((d: { response: unknown; name: string }) => z.object({
    response: z.unknown(), name: z.string().trim().min(1).max(60),
  }).parse(d))
  .handler(async ({ data }) => (await import("./passkey.server")).finishRegistration(data.response, data.name));
export const beginPasskeyLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { remember: boolean }) => z.object({ remember: z.boolean() }).parse(d))
  .handler(async ({ data }) => (await import("./passkey.server")).beginLogin(data.remember));
export const finishPasskeyLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { response: unknown }) => z.object({ response: z.unknown() }).parse(d))
  .handler(async ({ data }) => (await import("./passkey.server")).finishLogin(data.response));
export const changePasskey = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; action: "rename" | "remove"; name?: string; password?: string }) =>
    z.object({ id: z.string().min(1).max(1500), action: z.enum(["rename", "remove"]),
      name: z.string().trim().min(1).max(60).optional(), password: proof }).parse(d))
  .handler(async ({ data }) => (await import("./passkey.server")).manage(data));
