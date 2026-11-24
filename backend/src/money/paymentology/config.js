import crypto from 'node:crypto';

/**
 * Paymentology Sprint (Companion API) settings. Everything comes from environment variables
 * supplied during Paymentology onboarding; nothing is hard-coded.
 *
 *   PAYMENTOLOGY_MODE             off | sandbox | live     (default off)
 *   PAYMENTOLOGY_TERMINAL_ID      10-character terminal ID issued by Paymentology
 *   PAYMENTOLOGY_TERMINAL_PASSWORD terminal password (checksum key)
 *   PAYMENTOLOGY_LOCAL_API_URL    Local API endpoint URL from Paymentology (UAT or production)
 *   PAYMENTOLOGY_ALLOWED_IPS      comma-separated source IPs allowed to call the Remote API (recommended)
 *   PAYMENTOLOGY_CHECKSUM_ALGO    sha256 (documented) — override only if Paymentology's Checksum Generator says otherwise
 *   PAYMENTOLOGY_CHECKSUM_CASE    upper | lower  (default upper, matching the documented examples)
 *   CARD_PROGRAMME_NAME           shown to drivers, e.g. "DROP Driver Card"
 */
export const PTY = {
  mode: (process.env.PAYMENTOLOGY_MODE || 'off').toLowerCase(),
  terminalId: process.env.PAYMENTOLOGY_TERMINAL_ID || '',
  password: process.env.PAYMENTOLOGY_TERMINAL_PASSWORD || '',
  localUrl: process.env.PAYMENTOLOGY_LOCAL_API_URL || '',
  allowedIps: (process.env.PAYMENTOLOGY_ALLOWED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
  algo: (process.env.PAYMENTOLOGY_CHECKSUM_ALGO || 'sha256').toLowerCase(),
  checksumCase: (process.env.PAYMENTOLOGY_CHECKSUM_CASE || 'upper').toLowerCase(),
  programme: process.env.CARD_PROGRAMME_NAME || 'DROP Driver Card',
  cardYears: Number(process.env.CARD_EXPIRY_YEARS || 3),
  userAgent: `DROP-Platform/1.0 (Node.js ${process.version})`,
};

export const cardsEnabled = () => PTY.mode === 'live' ? Boolean(PTY.terminalId && PTY.password && PTY.localUrl) : PTY.mode === 'sandbox';
export const isSandbox = () => PTY.mode === 'sandbox';

/** In sandbox mode without real credentials, sign with a local test password so the full path is exercised. */
const key = () => PTY.password || (isSandbox() ? 'drop-sandbox-terminal-password' : '');
export const terminalId = () => PTY.terminalId || (isSandbox() ? 'SANDBOX001' : '');

/**
 * Checksum: HMAC of the method name concatenated with every argument value (in parameter order,
 * exactly as transmitted, no separators), keyed with the terminal password.
 * Paymentology documents the algorithm as HMAC-SHA256; confirm the exact string with their
 * Checksum Generator during UAT. Algorithm and letter case are configurable for that reason.
 */
export function checksum(method, values) {
  const mac = crypto.createHmac(PTY.algo === 'sha1' ? 'sha1' : 'sha256', key()).update(method + values.map((v) => String(v)).join('')).digest('hex');
  return PTY.checksumCase === 'lower' ? mac : mac.toUpperCase();
}

export function checksumValid(method, values, supplied) {
  if (!key() || typeof supplied !== 'string') return false;
  const expected = checksum(method, values).toLowerCase();
  const got = supplied.trim().toLowerCase();
  return expected.length === got.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}
