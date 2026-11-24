import { useEffect, useState } from 'react';

const KEY = 'drop.intro';

/** A short brand reveal on the first visit of a session. Skipped for reduced motion and repeat views. */
export function Intro() {
  const [show, setShow] = useState(() => {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || sessionStorage.getItem(KEY)) return false;
      sessionStorage.setItem(KEY, '1');
      return true;
    } catch { return false; }
  });
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 1650);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return <div className="intro fixed inset-0 z-[80] flex items-center justify-center bg-navy text-white" aria-hidden="true">
    <div className="text-center">
      <img src="/brand/drop-symbol-dark.svg" alt="" className="intro-tag mx-auto h-24 w-24" />
      <div className="intro-word mt-4 overflow-hidden"><img src="/brand/drop-wordmark-dark.svg" alt="DROP" className="inline-block h-20 sm:h-24" /></div>
      <div className="intro-line mx-auto mt-5 h-[3px] w-40 rounded bg-orange" />
      <p className="intro-tag mt-4 text-[12px] font-bold uppercase tracking-[3px] text-orange">Ride Smart. Go Further.</p>
    </div>
  </div>;
}
