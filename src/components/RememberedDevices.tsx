import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRememberedDevices, removeRememberedDevices } from "@/lib/trusted-device.functions";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./ui/alert-dialog";
import { toast } from "sonner";

export function RememberedDevices({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const key = ["remembered-devices", userId];
  const devices = useQuery({ queryKey: key, queryFn: () => getRememberedDevices(), refetchInterval: 30000 });
  const [target, setTarget] = useState<{ id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function revoke() {
    if (!target || busy) return;
    setBusy(true); setError("");
    try {
      await removeRememberedDevices({ data: { id: target.id, confirmed: true } });
      qc.setQueryData<Awaited<ReturnType<typeof getRememberedDevices>>>(key,
        old => old?.filter(device => target.id !== null && device.id !== target.id));
      setTarget(null);
      toast.success("Device trust removed. OTP will be required at the next login.");
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not remove device trust. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="border-border bg-surface rounded-2xl border p-5 space-y-3">
    <h2 className="font-semibold">Remembered devices</h2>
    <p className="text-sm text-muted-foreground">These browsers or apps can skip the login OTP until the expiry shown. Removing trust requires OTP at their next login but does not sign out an open session.</p>
    {devices.isPending ? <p role="status">Loading remembered devices…</p> :
      devices.isError ? <div role="alert"><p>Could not load remembered devices.</p><button className="text-primary" onClick={() => void devices.refetch()}>Try again</button></div> :
      devices.data.length === 0 ? <p className="text-sm">No remembered devices.</p> :
      <><ul className="space-y-3">{devices.data.map((device, index) => <li key={device.id} className="border-border border rounded-xl p-3 space-y-1">
        <p className="font-medium text-sm">{device.label}{!device.current && ` ${index + 1}`}</p>
        <p className="text-xs text-muted-foreground">Remembered {new Date(device.createdAt).toLocaleString()}<br/>Expires {new Date(device.expiresAt).toLocaleString()}</p>
        <button className="text-destructive text-sm" disabled={busy} onClick={() => { setError(""); setTarget({ id: device.id }); }}>Remove device</button>
      </li>)}</ul>
      <button className="text-destructive text-sm" disabled={busy} onClick={() => { setError(""); setTarget({ id: null }); }}>Remove all remembered devices</button></>}
    <AlertDialog open={target !== null} onOpenChange={open => { if (!open && !busy) setTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{target?.id === null ? "Remove all remembered devices?" : "Remove this remembered device?"}</AlertDialogTitle>
          <AlertDialogDescription>OTP will be required at the next login. Existing signed-in sessions will remain open.</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void revoke(); }}>{busy ? "Removing…" : "Confirm removal"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
