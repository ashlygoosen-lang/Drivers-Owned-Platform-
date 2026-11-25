/**
 * Paystack: collects passenger card payments. Paystack settles to the bank account registered on the
 * DROP merchant profile, which is the pool account.
 *
 *   PAYSTACK_SECRET_KEY   sk_test_… or sk_live_…   (required to accept card payments)
 *   PUBLIC_URL            https://your-domain        (Paystack sends the passenger back here)
 *   PAYSTACK_BASE_URL     override for tests only
 */
import crypto from 'node:crypto';
import { HttpError } from '../validate.js';

const BASE = (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co').replace(/\/$/, '');
const secret = () => process.env.PAYSTACK_SECRET_KEY || '';
export const paystackEnabled = () => Boolean(secret());
export const paystackMode = () => (secret().startsWith('sk_live_') ? 'live' : secret() ? 'test' : 'off');

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(502, 'The payment service is not reachable. Please try again or choose cash.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new HttpError(502, data.message ? `Payment service: ${data.message}` : 'The payment service returned an error.');
  return data.data;
}

/** Start a card payment. Amount in cents (ZAR). Returns { authorization_url, reference }. */
export function initialize({ email, amountCents, reference, callbackUrl, metadata }) {
  return request('POST', '/transaction/initialize', { email, amount: amountCents, currency: 'ZAR', reference, callback_url: callbackUrl, metadata, channels: ['card'] });
}

/** Confirm a payment with Paystack (never trust the browser redirect alone). */
export function verify(reference) {
  return request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Full refund, or a partial one when amountCents is given (e.g. unused days of a monthly plan). */
export function refund(reference, amountCents) {
  return request('POST', '/refund', { transaction: reference, ...(amountCents && { amount: amountCents }) });
}

/** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key. */
export function webhookValid(rawBody, signature) {
  if (!secret() || !signature) return false;
  const expected = crypto.createHmac('sha512', secret()).update(rawBody).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
