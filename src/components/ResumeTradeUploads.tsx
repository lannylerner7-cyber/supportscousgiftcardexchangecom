import { useRef, useState } from "react";
import { IMAGE_ACCEPT } from "@/lib/image-validation";
import { uploadTradePhoto } from "@/lib/upload-client";
import { notifyTradeSubmitted } from "@/lib/alerts.functions";
import {NativePhotoPicker} from "./NativePhotoPicker";

export function ResumeTradeUploads({ tradeId, pending, onSaved }: {
  tradeId: string; pending: number; onSaved: () => void;
}) {
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  async function upload() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setMessages([]);
    try {
      for (const [index, file] of files.entries()) {
        setMessages(p => [...p, `Photo ${index + 1}: uploading…`]);
        try {
          await uploadTradePhoto(tradeId, file);
          setMessages(p => [...p, `Photo ${index + 1}: saved.`]);
          onSaved();
        } catch (error) {
          setMessages(p => [...p, `Photo ${index + 1}: ${error instanceof Error ? error.message : "Upload failed. Retry this photo."}`]);
        }
      }
      void notifyTradeSubmitted({ data: { tradeId } }).catch(() => undefined);
    } finally { busy.current = false; setWorking(false); }
  }
  return <section className="border-border bg-surface space-y-3 rounded-2xl border p-4">
    <h2 className="font-semibold">Add or retry card photos</h2>
    <p className="text-muted-foreground text-sm">
      {pending > 0 ? `${pending} photo upload(s) are unfinished. Reselect the original photos to resume. ` : ""}
      Up to five photos per trade. Retrying a saved photo does not add it twice. Your browser may require you to select photos again after a reload.
    </p>
    <input aria-label="Select photos to resume" type="file" accept={IMAGE_ACCEPT} multiple disabled={working}
      onChange={e => { const selected = Array.from(e.target.files ?? []); setFiles(selected); setMessages(selected.length > 5 ? ["Choose at most five photos."] : []); }} />
    <NativePhotoPicker disabled={working||files.length>=5} onPhoto={file=>setFiles(previous=>previous.length<5?[...previous,file]:previous)}
      onError={message=>setMessages([message])}/>
    <button disabled={working || !files.length || files.length > 5} onClick={() => void upload()}
      className="bg-primary text-primary-foreground rounded-full px-5 py-2 disabled:opacity-40">
      {working ? "Uploading — please wait…" : "Upload / retry selected photos"}
    </button>
    <div role="status" aria-live="polite">{messages.map((message, i) => <p key={i} className="text-sm">{message}</p>)}</div>
  </section>;
}
