import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Spinner } from '../components/ui';

export type Notify = (m: string) => void;

export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(''); } catch (err) { setError((err as Error).message); }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

export function Loading() { return <p className="flex items-center gap-3 py-6 text-sm text-[#505d71]"><Spinner /> Loading…</p>; }
export function Empty({ children }: { children: React.ReactNode }) { return <p className="rounded-xl border border-dashed border-[#cbd2dc] p-6 text-center text-sm text-[#505d71]">{children}</p>; }

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-[#d1dae5]">{head.map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="table-row border-b border-[#dee4ed] align-top">{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}</tbody></table></div>;
}

