import { useEffect, useRef, useState } from "react";

import { naira } from "@/lib/format";

export function CountUpNaira({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    const delta = value - begin;
    if (delta === 0) return;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(begin + delta * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className={className}>{naira(Math.round(shown))}</span>;
}
