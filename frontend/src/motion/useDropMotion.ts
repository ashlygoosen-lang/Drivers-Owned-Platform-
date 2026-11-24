import { useEffect, useState } from 'react';

const ease = 'cubic-bezier(.22, 1, .36, 1)';
const media = (q: string) => window.matchMedia(q);

/**
 * DROP motion system — progressive enhancement only. Content is visible without JS or motion support.
 *  - [data-reveal]            fade/slide in on scroll ("up" default, "left", "right", "scale", "clip")
 *  - [data-reveal-stagger]    children reveal one after another
 *  - .motion-button / [data-tilt] / [data-spotlight] receive --pointer-x/y for magnetic, tilt and glow effects
 * Intensity adapts: shorter distances and durations on touch/small screens, none for reduced motion.
 */
export function useDropMotion(deps: unknown[] = []) {
  useEffect(() => {
    const reduce = media('(prefers-reduced-motion: reduce)');
    const desktop = media('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
    const running = new Set<Animation>();
    if (reduce.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

    const keyframes = (kind: string, d: number): Keyframe[] => {
      switch (kind) {
        case 'left': return [{ opacity: 0, translate: `${-d * 1.4}px 0` }, { opacity: 1, translate: '0 0' }];
        case 'right': return [{ opacity: 0, translate: `${d * 1.4}px 0` }, { opacity: 1, translate: '0 0' }];
        case 'scale': return [{ opacity: 0, scale: '.94' }, { opacity: 1, scale: '1' }];
        case 'clip': return [{ opacity: .5, clipPath: 'inset(0 0 18% 0)', scale: '1.06' }, { opacity: 1, clipPath: 'inset(0 0 0% 0)', scale: '1' }];
        default: return [{ opacity: 0, translate: `0 ${d}px` }, { opacity: 1, translate: '0 0' }];
      }
    };
    const play = (node: HTMLElement, delay: number) => {
      const big = desktop.matches;
      const kind = node.dataset.reveal || 'up';
      node.style.removeProperty('opacity');
      const a = node.animate(keyframes(kind, big ? 28 : 14), { duration: big ? (kind === 'clip' ? 1200 : 900) : 520, delay, easing: ease, fill: 'backwards' });
      running.add(a);
      a.finished.then(() => running.delete(a), () => running.delete(a));
    };

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target as HTMLElement;
        io.unobserve(node);
        if (node.hasAttribute('data-reveal-stagger')) {
          Array.from(node.children).forEach((child, i) => {
            const el = child as HTMLElement;
            if (!el.dataset.reveal) el.dataset.reveal = node.dataset.revealStagger || 'up';
            play(el, Math.min(i, 6) * (desktop.matches ? 90 : 50));
          });
        } else play(node, Number(node.dataset.revealDelay || 0));
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    // Hide only what this effect will reveal; everything is restored on cleanup.
    const hidden: HTMLElement[] = [];
    document.querySelectorAll<HTMLElement>('[data-reveal], [data-reveal-stagger]').forEach((n) => {
      const targets = n.hasAttribute('data-reveal-stagger') ? Array.from(n.children) as HTMLElement[] : [n];
      targets.forEach((t) => { t.style.opacity = '0'; hidden.push(t); });
      io.observe(n);
    });

    // Pointer-driven effects (desktop, fine pointer only), batched with rAF.
    let frame = 0;
    let target: HTMLElement | null = null;
    const reset = () => { if (target) { target.style.removeProperty('--pointer-x'); target.style.removeProperty('--pointer-y'); target = null; } };
    const onPointer = (event: PointerEvent) => {
      if (!desktop.matches || event.pointerType === 'touch') return;
      const next = (event.target as Element).closest<HTMLElement>('.motion-button, [data-tilt], [data-spotlight]');
      if (target !== next) { reset(); target = next; }
      cancelAnimationFrame(frame);
      if (!next) return;
      const r = next.getBoundingClientRect();
      const x = Math.max(-.5, Math.min(.5, (event.clientX - r.left) / r.width - .5));
      const y = Math.max(-.5, Math.min(.5, (event.clientY - r.top) / r.height - .5));
      frame = requestAnimationFrame(() => { next.style.setProperty('--pointer-x', x.toFixed(3)); next.style.setProperty('--pointer-y', y.toFixed(3)); });
    };
    document.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('pointerleave', reset);
    const onReduce = () => { if (reduce.matches) { running.forEach((a) => a.cancel()); running.clear(); reset(); } };
    reduce.addEventListener('change', onReduce);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      running.forEach((a) => a.finish());
      hidden.forEach((t) => t.style.removeProperty('opacity'));
      document.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', reset);
      reduce.removeEventListener('change', onReduce);
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Which section is in view, for the animated navigation indicator. */
export function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState('');
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
      const best = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
      setActive(best && best[1] > 0 ? best[0] : '');
    }, { threshold: [0, .2, .4, .6], rootMargin: '-80px 0px -40% 0px' });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join()]);
  return active;
}

/** Scroll progress 0–1 and whether the page has scrolled past the hero. */
export function useScrollProgress() {
  const [state, setState] = useState({ progress: 0, scrolled: false });
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        setState({ progress: max > 0 ? scrollY / max : 0, scrolled: scrollY > 24 });
      });
    };
    update();
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    return () => { removeEventListener('scroll', update); removeEventListener('resize', update); cancelAnimationFrame(frame); };
  }, []);
  return state;
}
