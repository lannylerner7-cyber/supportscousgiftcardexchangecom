import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { mailStatus, sendTestEmail } from "@/lib/alerts.functions";
import {
  adminMailSettings,
  adminSaveMailSettings,
  checkSpamWords,
} from "@/lib/admin.people.functions";
import { SupportDiagnostics } from "@/components/support/AdminSupportInbox";

export const Route = createFileRoute("/_authenticated/ScousGiftCardExchange/admin/mail")({
  component: AdminMail,
});

function AdminMail() {
  const qc = useQueryClient();
  const [emails, setEmails] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [testTo, setTestTo] = useState("");
  const [spamText, setSpamText] = useState("");
  const [spamHits, setSpamHits] = useState<string[] | null>(null);

  const settings = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => adminMailSettings(),
  });

  const status = useQuery({ queryKey: ["mail-status"], queryFn: () => mailStatus() });

  useEffect(() => {
    if (!settings.data) return;
    setEmails(settings.data.alert_emails.join(", "));
    setFromName(settings.data.from_name);
    setReplyTo(settings.data.reply_to ?? "");
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      const list = emails
        .split(/[,\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      return adminSaveMailSettings({
        data: { emails: list, fromName: fromName.trim(), replyTo: replyTo.trim() },
      });
    },
    onSuccess: () => {
      toast.success("Mail settings saved");
      void qc.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async () => {
      const res = await sendTestEmail({ data: { to: testTo.trim().toLowerCase() } });
      if (!res.sent) throw new Error(res.reason ?? "Email could not be sent");
    },
    onSuccess: () => toast.success("Test email sent"),
    onError: (e: Error) => toast.error(e.message),
  });

  const spam = useMutation({
    mutationFn: async () => checkSpamWords({ data: { text: spamText } }),
    onSuccess: (r) => setSpamHits(r.hits),
  });

  return (
    <div className="space-y-5">
      <h1 className="font-display text-lg font-bold">Mail & alerts</h1>
      <SupportDiagnostics />

      <section className="border-border/70 bg-surface space-y-3 rounded-2xl border p-5">
        <p className="text-sm font-semibold">Sending status</p>
        <p className="text-muted-foreground text-xs">
          {status.data?.configured
            ? `Sending as ${status.data.from}`
            : "No mail server configured yet — codes and alerts can't be delivered."}
        </p>
      </section>

      <section className="border-border/70 bg-surface space-y-3 rounded-2xl border p-5">
        <p className="text-sm font-semibold">Alert addresses</p>
        <p className="text-muted-foreground text-xs">
          Every new gift card, withdrawal request and contact message is emailed here.
        </p>
        <input
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder="you@example.com, desk@example.com"
          className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="From name"
            className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
          />
          <input
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="Reply-to address"
            className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
          />
        </div>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="bg-gold-gradient text-primary-foreground flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50"
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save settings
        </button>
      </section>

      <section className="border-border/70 bg-surface space-y-3 rounded-2xl border p-5">
        <p className="text-sm font-semibold">Send a test email</p>
        <input
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="where should it go?"
          className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
        />
        <button
          type="button"
          disabled={test.isPending || !testTo}
          onClick={() => test.mutate()}
          className="border-border flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send test
        </button>
      </section>

      <section className="border-border/70 bg-surface space-y-3 rounded-2xl border p-5">
        <p className="text-sm font-semibold">Spam-word checker</p>
        <p className="text-muted-foreground text-xs">
          Paste a subject or message to see words that often push email into spam.
        </p>
        <textarea
          rows={4}
          value={spamText}
          onChange={(e) => setSpamText(e.target.value)}
          className="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm"
        />
        <button
          type="button"
          disabled={spam.isPending || !spamText.trim()}
          onClick={() => spam.mutate()}
          className="border-border rounded-full border px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          Check text
        </button>
        {spamHits && (
          <p className="text-xs">
            {spamHits.length === 0 ? (
              <span className="text-money font-semibold">Clean — no risky words found.</span>
            ) : (
              <span className="text-warning font-semibold">
                Risky words: {spamHits.join(", ")}
              </span>
            )}
          </p>
        )}
      </section>
    </div>
  );
}
