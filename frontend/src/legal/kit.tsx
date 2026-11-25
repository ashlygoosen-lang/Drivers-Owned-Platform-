import type { ReactNode } from 'react';

/** Small building blocks for the legal pages: numbered sections, plain-language notices, placeholders. */
export function S({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return <section id={id} className="scroll-mt-6">
    <h2 className="mt-6 font-display text-xl font-bold text-navy"><span className="mr-2 text-[#8a96a8]">{n}</span>{title}</h2>
    <div className="mt-3 grid gap-3">{children}</div>
  </section>;
}
export const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;
export function L({ items }: { items: ReactNode[] }) { return <ul className="grid gap-2">{items.map((x, i) => <li key={i} className="ml-5 list-disc">{x}</li>)}</ul>; }
export function O({ items }: { items: ReactNode[] }) { return <ol className="grid gap-2">{items.map((x, i) => <li key={i} className="ml-5 list-decimal">{x}</li>)}</ol>; }
/** Clauses that limit our liability or place a risk on you must be drawn to your attention (CPA s 49). */
export function Important({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border-l-4 border-orange bg-orange/10 p-4"><p className="mb-1 text-[12px] font-bold uppercase tracking-wide text-[#8a3a00]">Important — please read</p><div className="grid gap-2 font-semibold">{children}</div></div>;
}
export function Box({ children }: { children: ReactNode }) { return <div className="rounded-xl bg-[#e9eef4] p-4">{children}</div>; }
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="border-b border-[#cfd7e1]">{head.map((h) => <th key={h} className="p-2 font-semibold">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-[#e1e6ed] align-top">{r.map((c, j) => <td key={j} className="p-2">{c}</td>)}</tr>)}</tbody></table></div>;
}
export const A = ({ href, children }: { href: string; children: ReactNode }) => <a className="font-semibold text-navy underline" href={href}>{children}</a>;
