import { useEffect, useState } from 'react';

/** Loads an official logo SVG once and returns its viewBox and inner markup, so mockups embed real vectors. */
const cache = new Map<string, Promise<{ viewBox: string; inner: string }>>();
export function loadSvg(name: string) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`/brand/${name}.svg`).then((r) => r.text()).then((text) => {
      const viewBox = /viewBox="([^"]+)"/.exec(text)?.[1] || '0 0 100 100';
      const inner = text.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '');
      return { viewBox, inner };
    }));
  }
  return cache.get(name)!;
}

/** Place an official logo inside an SVG mockup at x/y with the given height (width keeps aspect). */
export function Mark({ name, x = 0, y = 0, h, w, anchor = 'start' }: { name: string; x?: number; y?: number; h: number; w?: number; anchor?: 'start' | 'middle' | 'end' }) {
  const [svg, setSvg] = useState<{ viewBox: string; inner: string } | null>(null);
  useEffect(() => { let on = true; loadSvg(name).then((s) => on && setSvg(s)); return () => { on = false; }; }, [name]);
  if (!svg) return null;
  const [, , vw, vh] = svg.viewBox.split(/\s+/).map(Number);
  const width = w ?? (h * vw) / vh;
  const height = w ? (w * vh) / vw : h;
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  return <svg x={left} y={y} width={width} height={height} viewBox={svg.viewBox} dangerouslySetInnerHTML={{ __html: svg.inner }} />;
}

function save(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function serialise(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = "text{font-family:Inter,'Helvetica Neue',Arial,sans-serif}";
  clone.prepend(style);
  return new XMLSerializer().serializeToString(clone);
}

export function downloadSvg(svg: SVGSVGElement | null, filename: string) {
  if (!svg) return;
  save(new Blob([serialise(svg)], { type: 'image/svg+xml' }), `${filename}.svg`);
}

export async function downloadPng(svg: SVGSVGElement | null, filename: string, scale = 3) {
  if (!svg) return;
  const [, , vw, vh] = (svg.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([serialise(svg)], { type: 'image/svg+xml' }));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = vw * scale; canvas.height = vh * scale;
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  canvas.toBlob((b) => b && save(b, `${filename}.png`), 'image/png');
}
