import { useEffect, useState } from "react";

const COLORS = ["var(--gold)", "var(--money)", "var(--chart-3)", "var(--chart-5)"];

export function Confetti({ fire }: { fire: boolean }) {
  const [pieces, setPieces] = useState<number[]>([]);

  useEffect(() => {
    if (!fire) return;
    setPieces(Array.from({ length: 40 }, (_, i) => i));
    const t = window.setTimeout(() => setPieces([]), 2600);
    return () => window.clearTimeout(t);
  }, [fire]);

  if (pieces.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden" aria-hidden="true">
      {pieces.map((i) => (
        <span
          key={i}
          className="absolute top-0 block h-2 w-2 rounded-[2px]"
          style={{
            left: `${(i * 97) % 100}%`,
            background: COLORS[i % COLORS.length],
            animation: `confetti-fall ${1.4 + ((i % 7) * 0.18)}s ease-in ${(i % 11) * 0.08}s forwards`,
          }}
        />
      ))}
    </div>
  );
}
