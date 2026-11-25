import { log } from './monitor.js';

/**
 * Transactional email (password reset, security notices). Uses Resend (resend.com, free tier
 * covers launch volume) when RESEND_API_KEY is set; sender MAIL_FROM, e.g. "DROP <no-reply@drop.co.za>"
 * on a domain verified in Resend. Without a key, outside production the message is written to the log
 * so the flow can be tested locally; in production it is reported as not sent.
 */
export async function sendMail({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV !== 'production') { log('info', 'mail (not sent: no RESEND_API_KEY)', { to, subject, text }); return { sent: false, dev: true }; }
    log('warn', 'mail not sent: RESEND_API_KEY missing', { subject });
    return { sent: false };
  }
  try {
    const res = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'DROP <no-reply@drop.co.za>', to: [to], subject, text, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { log('warn', 'mail failed', { status: res.status }); return { sent: false }; }
    return { sent: true };
  } catch (err) { log('warn', 'mail failed', { error: err.message }); return { sent: false }; }
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
export function emailLayout(title, paragraphs, button) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font:15px/1.6 Inter,Arial,sans-serif;color:#1d2b40">${esc(p)}</p>`).join('');
  const btn = button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#FF6B00;color:#071B3A;padding:12px 22px;border-radius:10px;font:700 15px Inter,Arial,sans-serif;text-decoration:none">${esc(button.label)}</a></p>` : '';
  return `<div style="background:#F5F7FA;padding:24px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:28px"><p style="font:800 22px Manrope,Arial,sans-serif;color:#071B3A;margin:0 0 18px">DROP</p><h1 style="font:700 20px Manrope,Arial,sans-serif;color:#071B3A;margin:0 0 14px">${esc(title)}</h1>${body}${btn}<p style="font:12px/1.5 Inter,Arial,sans-serif;color:#6b7789;margin-top:24px">DROP · a division of VINK Group (Pty) Ltd · 2018/079316/07. DROP will never ask for your password or one-time codes.</p></div></div>`;
}
