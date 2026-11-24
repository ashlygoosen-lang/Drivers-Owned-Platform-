import { useEffect, useRef, useState } from 'react';
import { money as fmtMoney } from '../lib/api';

/** Counts up to `value` once it scrolls into view. Renders the final value without motion support. */
export function Counter({ value, money = false, prefix = '', suffix = '', duration = 1400 }: { value: number; money?: boolean; prefix?: string; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window) || value === 0) { setShown(value); return; }
    let frame = 0;
    setShown(0);
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 4);
        setShown(p === 1 ? value : value * eased);
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(node);
    return () => { io.disconnect(); cancelAnimationFrame(frame); };
  }, [value, duration]);
  const decimals = value % 1 ? 2 : 0;
  const text = money ? fmtMoney(Number(shown.toFixed(decimals))) : Math.round(shown).toLocaleString('en-ZA');
  return <span ref={ref} className="tabular-nums">{prefix}{text}{suffix}</span>;
}
