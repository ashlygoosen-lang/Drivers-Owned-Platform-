/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cloudflare Turnstile (Phase 4 bot defence). When the server reports a site key, sign-up, sign-in,
 * driver applications, enquiries and bookings carry a fresh token. The widget runs invisibly and only
 * shows a checkbox if Cloudflare is unsure about the visitor.
 */
let siteKeyP: Promise<string | null> | null = null;
export function turnstileSiteKey(base: string) {
  siteKeyP ||= fetch(`${base}/security/config`).then((r) => r.json()).then((d) => d.turnstileSiteKey || null).catch(() => null);
  return siteKeyP;
}

let scriptP: Promise<any> | null = null;
function loadScript(): Promise<any> {
  const w = window as any;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  scriptP ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve(w.turnstile);
    s.onerror = () => { scriptP = null; reject(new Error('Security check could not load.')); };
    document.head.appendChild(s);
  });
  return scriptP;
}

export async function turnstileToken(siteKey: string): Promise<string> {
  const ts = await loadScript();
  let host = document.getElementById('drop-turnstile');
  if (!host) {
    host = document.createElement('div');
    host.id = 'drop-turnstile';
    host.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:100';
    document.body.appendChild(host);
  }
  return new Promise((resolve, reject) => {
    const id = ts.render(host, {
      sitekey: siteKey, appearance: 'interaction-only', theme: 'light',
      callback: (t: string) => { resolve(t); setTimeout(() => ts.remove(id), 0); },
      'error-callback': () => { reject(new Error('The security check failed. Please refresh the page and try again.')); ts.remove(id); },
    });
  });
}
