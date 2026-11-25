import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import { api } from './api';
import { API_URL } from './config';

/**
 * Live events (chat, call signalling, trip status, GPS) over Server-Sent Events while the app is in
 * the foreground. In the background the stream closes to save battery and push notifications take over.
 */
type Handler = (event: string, data: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
const EVENTS = ['message', 'read', 'trip', 'location', 'passenger-location', 'call:ring', 'call:accepted', 'call:ended', 'call:signal'] as const;
interface LiveValue { connected: boolean; on: (fn: Handler) => () => void }
const Ctx = createContext<LiveValue>({ connected: false, on: () => () => undefined });
export const useLive = () => useContext(Ctx);

export function LiveProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Set<Handler>());
  const on = useCallback((fn: Handler) => { handlers.current.add(fn); return () => { handlers.current.delete(fn); }; }, []);

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource<(typeof EVENTS)[number] | 'ready'> | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const close = () => { es?.removeAllEventListeners(); es?.close(); es = null; setConnected(false); };
    const connect = async () => {
      close();
      try {
        const { ticket } = await api<{ ticket: string }>('/comms/ticket', { body: {} });
        if (stopped) return;
        es = new EventSource(`${API_URL}/comms/stream?ticket=${encodeURIComponent(ticket)}`, { pollingInterval: 0 });
        es.addEventListener('ready', () => setConnected(true));
        for (const name of EVENTS) {
          es.addEventListener(name, (e) => {
            const raw = (e as { data?: string | null }).data;
            if (!raw) return;
            let data: unknown; try { data = JSON.parse(raw); } catch { return; }
            handlers.current.forEach((h) => h(name, data));
          });
        }
        es.addEventListener('error', () => { close(); if (!stopped && AppState.currentState === 'active') retry = setTimeout(connect, 3000); });
      } catch { if (!stopped) retry = setTimeout(connect, 8000); }
    };
    void connect();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void connect(); else { clearTimeout(retry); close(); } });
    return () => { stopped = true; clearTimeout(retry); sub.remove(); close(); };
  }, [enabled]);

  return <Ctx.Provider value={{ connected, on }}>{children}</Ctx.Provider>;
}
