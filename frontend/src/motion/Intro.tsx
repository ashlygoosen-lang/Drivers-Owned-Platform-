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
  return <div className="intro fixed inset-0 z-[80] flex items-center justify-center bg-wine text-white" aria-hidden="true">
    <div className="text-center">
      <div className="intro-word overflow-hidden font-display text-[68px] font-normal leading-none tracking-[-2px] sm:text-[96px]"><span className="inline-block">DROP</span></div>
      <div className="intro-line mx-auto mt-5 h-px w-40 bg-lime" />
      <p className="intro-tag mt-4 text-[11px] font-semibold tracking-[3px] text-lime">DRIVERS OWNED PLATFORM</p>
    </div>
  </div>;
}
