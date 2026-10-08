import { Hammer } from "lucide-react";

export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-border/70 bg-surface rounded-3xl border p-10 text-center">
      <Hammer className="text-primary mx-auto h-7 w-7" />
      <h1 className="font-display mt-4 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm">{body}</p>
    </div>
  );
}
