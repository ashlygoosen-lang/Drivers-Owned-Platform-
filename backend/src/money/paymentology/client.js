/**
 * Paymentology Local API client (calls initiated by DROP): issue and control driver cards.
 * Methods follow the Sprint Companion API reference: CreateLinkedCardMaskedResponse, StopCard, UnstopCard.
 * The masked-response variant is used deliberately so full card numbers and CVVs never reach DROP's
 * servers (keeps DROP out of PCI DSS cardholder-data scope).
 */
import crypto from 'node:crypto';
import { PTY, checksum, terminalId, isSandbox } from './config.js';
import { buildCall, parseResponse, xmlDate } from './xmlrpc.js';
import { HttpError } from '../../validate.js';

export const txnId = () => `DRP${Date.now()}${crypto.randomInt(1000, 9999)}`;

async function call(method, args) {
  // args: [{ type, value }] excluding terminalID (first) and checksum (last)
  const params = [{ type: 'string', value: terminalId() }, ...args];
  const sum = checksum(method, params.map((p) => p.value));
  const xml = buildCall(method, [...params, { type: 'string', value: sum }]);
  if (isSandbox() && !PTY.localUrl) return sandbox(method, args);
  let res;
  try {
    res = await fetch(PTY.localUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'User-Agent': PTY.userAgent },
      body: xml,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new HttpError(502, 'The card service is not reachable right now. Please try again shortly.');
  }
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `Card service error (HTTP ${res.status}).`);
  const out = parseResponse(text);
  if (out.fault) throw new HttpError(502, 'The card service rejected the request.');
  return out;
}

/** Issue a virtual card linked to the driver's wallet reference. Returns masked card data only. */
export function createLinkedCard({ reference, firstName, lastName, idOrPassport, cellphone }) {
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + PTY.cardYears);
  return call('CreateLinkedCardMaskedResponse', [
    { type: 'string', value: reference },
    { type: 'string', value: firstName.slice(0, 50) },
    { type: 'string', value: lastName.slice(0, 50) },
    { type: 'string', value: (idOrPassport || '').slice(0, 20) },
    { type: 'string', value: (cellphone || '').slice(0, 20) },
    { type: 'string', value: expiry.toISOString().slice(0, 10) },
    { type: 'string', value: txnId() },
    { type: 'dateTime.iso8601', value: xmlDate() },
  ]);
}

/** reasonID: 1 lost, 2 stolen, 3 pending query (used for a temporary freeze), 7 suspected fraud. */
export function stopCard({ reference, cardIdentifier, reasonID, note = '' }) {
  return call('StopCard', [
    { type: 'string', value: reference },
    { type: 'string', value: cardIdentifier },
    { type: 'string', value: String(reasonID) },
    { type: 'string', value: note.slice(0, 255) },
    { type: 'string', value: txnId() },
    { type: 'dateTime.iso8601', value: xmlDate() },
  ]);
}

export function unstopCard({ reference, cardIdentifier, note = '' }) {
  return call('UnstopCard', [
    { type: 'string', value: reference },
    { type: 'string', value: cardIdentifier },
    { type: 'string', value: note.slice(0, 255) },
    { type: 'string', value: txnId() },
    { type: 'dateTime.iso8601', value: xmlDate() },
  ]);
}

/** Sandbox: deterministic, clearly fake card data so the workflow can be tested without a programme. */
function sandbox(method) {
  if (method === 'CreateLinkedCardMaskedResponse') {
    const last4 = String(crypto.randomInt(1000, 9999));
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + PTY.cardYears);
    return { resultCode: 1, resultText: 'Approved (sandbox)', cardNumber: `5999 00** **** ${last4}`, cvv2: '***', validDate: `${String(exp.getMonth() + 1).padStart(2, '0')}/${String(exp.getFullYear()).slice(2)}`, expiryDate: '**/**', trackingNumber: `SBX${last4}${crypto.randomInt(100, 999)}` };
  }
  return { resultCode: 1, resultText: 'Approved (sandbox)' };
}
