import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AlertCircle, Lock, RefreshCw } from "lucide-react";

import { useSession } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { isDenied, supportApi } from "./api";
import { Conversation, ConversationSkeleton } from "./Conversation";

export const SUPPORT_SUMMARY_KEY = ["support-summary"] as const;

/** Live badge via the same batched hub; visible-only 30s fallback when disconnected. */
export function useSupportSummary(enabled = true) {
  const qc=useQueryClient();
  useEffect(()=>{
    if(!enabled||typeof EventSource==="undefined")return;
    let source:EventSource|null=null;
    let revoked=false;
    const close=()=>{source?.close();source=null;};
    const open=()=>{
      if(source||revoked||document.visibilityState!=="visible")return;
      source=new EventSource("/api/support?threadId=summary",{withCredentials:true});
      source.addEventListener("summary",event=>{
        try{
          const data=JSON.parse((event as MessageEvent).data) as {unread:number};
          if(Number.isSafeInteger(data.unread)&&data.unread>=0)qc.setQueryData(SUPPORT_SUMMARY_KEY,data);
        }catch{/* reconnect/fallback restores authoritative state */}
      });
      source.addEventListener("revoked",()=>{revoked=true;close();qc.removeQueries({queryKey:SUPPORT_SUMMARY_KEY});});
      source.onerror=()=>{if(source?.readyState===EventSource.CLOSED){close();}};
    };
    const visibility=()=>{if(document.visibilityState==="visible"){open();void qc.invalidateQueries({queryKey:SUPPORT_SUMMARY_KEY});}else close();};
    open();document.addEventListener("visibilitychange",visibility);
    return ()=>{close();document.removeEventListener("visibilitychange",visibility);};
  },[enabled,qc]);
  return useQuery({
    queryKey: SUPPORT_SUMMARY_KEY,
    queryFn: () => supportApi.summary(),
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: (n, e) => !isDenied(e) && n < 2,
    staleTime: 10_000,
  });
}

/** Member's own persistent thread. */
export function MemberChat({ active = true, className }: { active?: boolean; className?: string }) {
  const { user, loading: sessionLoading } = useSession();
  const qc = useQueryClient();
  const open = useQuery({
    queryKey: ["support-thread", user?.id],
    queryFn: () => supportApi.open(),
    enabled: !!user && active,
    staleTime: Infinity,
    retry: (n, e) => !isDenied(e) && n < 2,
  });

  if (sessionLoading || open.isLoading) return <ConversationSkeleton className={className} />;

  if (!user || (open.error && isDenied(open.error))) {
    return (
      <Notice
        className={className}
        icon={<Lock className="h-5 w-5" />}
        title="Sign in to chat with support"
        body="Your conversation is tied to your account, so we need to know it is you."
      />
    );
  }

  if (open.error || !open.data) {
    return (
      <Notice
        className={className}
        icon={<AlertCircle className="text-destructive h-5 w-5" />}
        title="Chat could not be opened"
        body={(open.error as Error | null)?.message ?? "Please try again."}
        action={
          <button
            type="button"
            onClick={() => void open.refetch()}
            className="bg-gold-gradient text-primary-foreground flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold"
            data-testid="button-chat-open-retry"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        }
      />
    );
  }

  return (
    <Conversation
      className={className}
      threadId={open.data.thread.id}
      userId={user.id}
      viewer="user"
      active={active}
      onThreadChange={(t) => {
        if (t) qc.setQueryData(SUPPORT_SUMMARY_KEY, { unread: t.unread_for_user });
      }}
    />
  );
}

function Notice({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center", className)}>
      <span className="bg-surface-2 text-muted-foreground flex h-11 w-11 items-center justify-center rounded-full">
        {icon}
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground max-w-xs text-xs">{body}</p>
      {action}
    </div>
  );
}
