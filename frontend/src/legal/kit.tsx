import type { ReactNode } from 'react';

/** Building blocks for the legal pages: numbered sections, plain-language notices, tables, links. */
export function S({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return <section id={id} data-title={title} className="legal-section scroll-mt-24 border-t border-[#e6ebf1] pt-8 first:border-t-0 first:pt-0">
    <h2 className="flex items-baseline gap-3 font-display text-[22px] font-extrabold leading-tight text-navy">
      <span className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef2f7] px-2 text-[14px] font-bold text-[#4D5B71]">{n.replace(/\.$/, '')}</span>
      <span>{title}</span>
    </h2>
    <div className="mt-4 grid gap-4">{children}</div>
  </section>;
}
export const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;
export const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-2 font-display text-[17px] font-bold text-navy">{children}</h3>;
export function L({ items }: { items: ReactNode[] }) {
  return <ul className="grid gap-2.5">{items.map((x, i) => <li key={i} className="relative pl-6 before:absolute before:left-1 before:top-[0.7em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-orange">{x}</li>)}</ul>;
}
export function O({ items }: { items: ReactNode[] }) {
  return <ol className="grid gap-3">{items.map((x, i) => <li key={i} className="flex gap-3"><span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-[12px] font-bold text-white">{i + 1}</span><span>{x}</span></li>)}</ol>;
}
/** Clauses that limit our liability or place a risk on you must be drawn to your attention (CPA s 49). */
export function Important({ children }: { children: ReactNode }) {
  return <aside className="rounded-2xl border border-[#f6c9a4] bg-[#fff6ee] p-5" role="note">
    <p className="mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[#9a4300]"><span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange text-[12px] text-white">!</span>Important: please read</p>
    <div className="grid gap-2 font-medium text-[#3a2410]">{children}</div>
  </aside>;
}
export function Box({ children }: { children: ReactNode }) { return <div className="rounded-2xl border border-[#dde5ee] bg-[#f3f6fa] p-5">{children}</div>; }
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto rounded-2xl border border-[#dde5ee]"><table className="w-full min-w-[520px] text-left text-[14px] leading-6">
    <thead className="bg-[#f3f6fa]"><tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-[#4D5B71]">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-[#e6ebf1] align-top even:bg-[#fafbfd]">{r.map((c, j) => <td key={j} className={`px-4 py-3 ${j === 0 ? 'font-semibold text-navy' : ''}`}>{c}</td>)}</tr>)}</tbody>
  </table></div>;
}
export const A = ({ href, children }: { href: string; children: ReactNode }) => <a className="font-semibold text-navy underline decoration-orange/60 decoration-2 underline-offset-2 hover:decoration-orange" href={href}>{children}</a>;
