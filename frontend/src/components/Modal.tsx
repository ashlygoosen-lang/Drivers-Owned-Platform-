import { useEffect, useRef } from 'react';
import { Icon, Label } from './ui';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate the open dialog out, then run `done`. */
export function closeWithMotion(done: () => void) {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog || reduced() || !dialog.animate) return done();
  const ease = 'cubic-bezier(.22, 1, .36, 1)';
  dialog.parentElement?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
  dialog.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(14px) scale(.985)' }], { duration: 200, easing: ease, fill: 'forwards' })
    .finished.then(done, done);
}

export function Modal({ title, eyebrow = 'DROP · Drivers Owned Platform', wide = false, onClose, children }: {
  title: string; eyebrow?: string; wide?: boolean; onClose: () => void; children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => closeWithMotion(onClose);
  const closeLatest = useRef(close);
  closeLatest.current = close;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLatest.current();
      if (event.key !== 'Tab') return;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] :is(button, input, select, textarea, a[href]):not([disabled])'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);

  return <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[#1f0609]/65 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className={`relative max-h-[92dvh] w-full overflow-y-auto rounded-2xl bg-[#fcfaf6] p-6 shadow-2xl sm:p-8 ${wide ? 'max-w-6xl' : 'max-w-xl'}`}>
      <button ref={closeRef} onClick={close} aria-label="Close dialog" className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-[#f2ede5] hover:rotate-90 hover:bg-[#e7decd]"><Icon name="close" /></button>
      <div className="mb-6 pr-12"><Label>{eyebrow}</Label><h2 id="dialog-title" className="font-display text-2xl font-semibold tracking-tight">{title}</h2></div>
      <div className="dialog-body">{children}</div>
    </section>
  </div>;
}
