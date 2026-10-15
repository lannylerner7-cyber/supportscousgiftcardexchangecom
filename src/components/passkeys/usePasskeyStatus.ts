import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { registerPasskey } from "@/lib/passkey-transport";

import { useSession } from "@/hooks/useAuth";
import { beginPasskeyRegistration, finishPasskeyRegistration, passkeyStatus } from "@/lib/passkey.functions";
import { passkeyStatusKey, passkeySupport, supportMessage, type PasskeyStatus } from "@/lib/passkey-client";

export function usePasskeyStatus() {
  const { user } = useSession();
  return useQuery<PasskeyStatus>({
    queryKey: passkeyStatusKey(user?.id),
    queryFn: () => passkeyStatus() as Promise<PasskeyStatus>,
    enabled: !!user?.id,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

/** Shared enrollment: server options -> browser ceremony -> server verify. */
export function useEnrollPasskey() {
  const qc = useQueryClient();
  const { user } = useSession();
  return useMutation({
    mutationFn: async ({ name, password }: { name: string; password?: string | undefined }) => {
      const msg = supportMessage(passkeySupport());
      if (msg) throw new Error(msg);
      const optionsJSON = await beginPasskeyRegistration({ data: password ? { password } : {} });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await registerPasskey(optionsJSON as any);
      return finishPasskeyRegistration({ data: { response, name: name.trim() || "My passkey" } });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: passkeyStatusKey(user?.id) }),
  });
}
