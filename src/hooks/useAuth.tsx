import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getAccount, type Account, type Profile } from "@/lib/account.functions";

export type { Profile };

export const ACCOUNT_QUERY_KEY = ["account"] as const;

/** The signed-in member, read from the server-side session cookie. */
export function useAccount() {
  return useQuery<Account>({
    queryKey: ACCOUNT_QUERY_KEY,
    queryFn: () => getAccount(),
    staleTime: 30_000,
  });
}

/** Call after sign-in, sign-out or a profile change. */
export function useRefreshAccount() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
}

export function useSession() {
  const { data, isLoading } = useAccount();
  return {
    session: data?.user ? { user: data.user } : null,
    user: data?.user ?? null,
    loading: isLoading,
  };
}

export function useProfile() {
  const { data, isLoading } = useAccount();
  return { profile: data?.profile ?? null, loading: isLoading };
}

export function useIsAdmin() {
  const { data, isLoading } = useAccount();
  return { isAdmin: data?.isAdmin ?? false, loading: isLoading };
}
