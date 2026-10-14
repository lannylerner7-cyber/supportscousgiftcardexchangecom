import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getRememberedDevices = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUserId } = await import("./guard.server");
  const { listRememberedDevices } = await import("./trusted-device.server");
  return listRememberedDevices(await requireUserId());
});

export const removeRememberedDevices = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string | null; confirmed: true }) =>
    z.object({ id: z.string().regex(/^[a-f0-9]{32}$/).nullable(), confirmed: z.literal(true) }).parse(data))
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { revokeRememberedDevices } = await import("./trusted-device.server");
    return revokeRememberedDevices(await requireUserId(), data.id);
  });
