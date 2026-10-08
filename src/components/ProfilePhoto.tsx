import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export function ProfilePhoto() {
  const { profile } = useProfile();
  return <Avatar className="h-12 w-12">
    {profile?.has_avatar && <AvatarImage
      src={`${import.meta.env.BASE_URL}api/avatar?v=${encodeURIComponent(profile.avatar_revision)}&u=${encodeURIComponent(profile.id)}`}
      alt="Your profile photo" />}
    <AvatarFallback>{profile?.full_name?.slice(0, 1).toUpperCase() || "M"}</AvatarFallback>
  </Avatar>;
}

type Pending = { id: string; revision: string; file: File | null };
export function ProfilePhotoControls() {
  const { profile } = useProfile();
  const qc = useQueryClient();
  const busyRef = useRef(false);
  const retry = useRef<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function save(file: File | null, repeat = false) {
    if (busyRef.current || !profile) return;
    setError(""); setMessage("");
    if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024)) {
      setError("Choose a JPG, PNG or WEBP photo, up to 5MB."); return;
    }
    const op = repeat && retry.current ? retry.current :
      { id: crypto.randomUUID(), revision: profile.avatar_revision, file };
    retry.current = op;
    busyRef.current = true; setBusy(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/avatar`, {
        method: op.file ? "POST" : "DELETE", credentials: "same-origin",
        headers: { "Content-Type": op.file?.type ?? "application/octet-stream",
          "X-Avatar-Request": "1", "X-Operation-Id": op.id, "X-Avatar-Revision": op.revision },
        body: op.file, signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        if (response.status < 500) retry.current = null;
        if (response.status === 409) await qc.invalidateQueries({ queryKey: ["account"] });
        throw new Error(await response.text());
      }
      retry.current = null;
      await Promise.all([qc.invalidateQueries({ queryKey: ["account"] }), qc.invalidateQueries({ queryKey: ["profile"] })]);
      setMessage(op.file ? "Profile photo saved." : "Profile photo removed.");
    } catch (e) {
      setError(retry.current ? "Could not confirm the change. Your existing photo stays visible. Retry safely below, or refresh to check." :
        e instanceof Error ? e.message : "Could not change your photo.");
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <div className="mb-4 flex flex-wrap items-center gap-3">
    <ProfilePhoto />
    <div className="space-y-2">
      <label className="block text-sm font-semibold" htmlFor="profile-photo">Profile photo</label>
      <input id="profile-photo" aria-describedby="photo-help" type="file" accept="image/jpeg,image/png,image/webp"
        disabled={busy || !profile || !!retry.current}
        className="block max-w-full text-xs file:mr-2 file:rounded-full file:border-0 file:px-3 file:py-2"
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void save(file); }} />
      <p id="photo-help" className="text-muted-foreground text-xs">Private · JPG, PNG or WEBP · Up to 5MB and 16 megapixels</p>
      {profile?.has_avatar && <button type="button" disabled={busy || !!retry.current}
        onClick={() => void save(null)} className="text-destructive text-xs font-semibold disabled:opacity-50">Remove photo</button>}
    </div>
    <div className="w-full text-sm" aria-live="polite" role="status">{busy ? "Saving photo…" : message}</div>
    {error && <p className="text-destructive w-full text-sm" role="alert">{error}</p>}
    {!busy && retry.current && <button type="button" className="text-primary text-sm font-semibold"
      onClick={() => void save(null, true)}>Retry photo change</button>}
  </div>;
}
