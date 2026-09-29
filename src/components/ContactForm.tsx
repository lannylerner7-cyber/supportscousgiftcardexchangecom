import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { submitContactMessage } from "@/lib/alerts.functions";

export function ContactForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await submitContactMessage({
        data: {
          name: form.name.trim(),
          email: form.email.trim(),
          message: form.message.trim(),
        },
      });
      if (!res.ok) {
        toast.error("You've sent a few messages already — please try again later.");
        return;
      }
      setDone(true);
      setForm({ name: "", email: "", message: "" });
      toast.success("Thanks — we've got your message.");
    } catch {
      toast.error("Couldn't send that. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border/70 bg-surface rounded-[2rem] border p-8">
      <h2 className="font-display text-2xl font-extrabold tracking-tight">Talk to us</h2>
      <p className="text-muted-foreground mt-1.5 text-sm">
        Questions, feedback or a card you can't find? Send us a note and we'll reply by email.
      </p>

      {done ? (
        <p className="border-money/40 bg-money/10 text-money mt-6 rounded-2xl border px-4 py-4 text-sm font-semibold">
          Message received — we'll be in touch shortly.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            required
            minLength={2}
            maxLength={120}
            placeholder="Your name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="border-border bg-surface-2 focus:border-primary w-full rounded-xl border px-4 py-3 text-sm outline-none"
          />
          <input
            required
            type="email"
            maxLength={200}
            placeholder="Your email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="border-border bg-surface-2 focus:border-primary w-full rounded-xl border px-4 py-3 text-sm outline-none"
          />
          <textarea
            required
            rows={4}
            minLength={5}
            maxLength={2000}
            placeholder="How can we help?"
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            className="border-border bg-surface-2 focus:border-primary w-full rounded-xl border px-4 py-3 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="bg-gold-gradient text-primary-foreground flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send message
          </button>
        </form>
      )}
    </div>
  );
}
