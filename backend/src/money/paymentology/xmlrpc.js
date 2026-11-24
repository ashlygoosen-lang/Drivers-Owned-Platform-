/**
 * Minimal XML-RPC codec for Paymentology Sprint (Companion API).
 * Requests: <methodCall><methodName/><params><param><value><string|int|i4|dateTime.iso8601|boolean>…
 * Responses: <methodResponse><params><param><value><struct><member><name/><value><int|string>…
 */

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encode = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Parse a methodCall. Returns { method, params: [{ type, value, raw }] } or throws. */
export function parseCall(xml) {
  if (typeof xml !== 'string' || xml.length > 64 * 1024) throw new Error('Invalid request body');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTDs are not allowed'); // XXE guard
  const method = /<methodName>\s*([A-Za-z0-9_.]+)\s*<\/methodName>/.exec(xml)?.[1];
  if (!method) throw new Error('Missing methodName');
  const paramsBlock = /<params>([\s\S]*)<\/params>/.exec(xml)?.[1] || '';
  const params = [];
  const re = /<param>\s*<value>([\s\S]*?)<\/value>\s*<\/param>/g;
  let m;
  while ((m = re.exec(paramsBlock))) {
    const inner = m[1].trim();
    const typed = /^<(string|int|i4|i8|double|boolean|dateTime\.iso8601)>([\s\S]*?)<\/\1>$/.exec(inner) || /^<(string|int|i4|i8|double|boolean|dateTime\.iso8601)\s*\/>$/.exec(inner);
    if (typed) {
      const type = typed[1];
      const raw = decode(typed[2] ?? '');
      const value = ['int', 'i4', 'i8'].includes(type) ? parseInt(raw, 10) : type === 'double' ? Number(raw) : type === 'boolean' ? raw === '1' : raw;
      params.push({ type, value, raw });
    } else {
      const raw = decode(inner); // untyped value = string
      params.push({ type: 'string', value: raw, raw });
    }
  }
  return { method, params };
}

/** Build a methodCall from [{type, value}] params (used by the Local API client and the simulator). */
export function buildCall(method, params) {
  const body = params.map(({ type, value }) => `<param><value><${type}>${encode(value)}</${type}></value></param>`).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${body}</params></methodCall>`;
}

/** Build a methodResponse with a struct. Integers use <int>, everything else <string>. */
export function buildResponse(fields) {
  const members = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) =>
    `<member><name>${k}</name><value>${Number.isInteger(v) ? `<int>${v}</int>` : `<string>${encode(v)}</string>`}</value></member>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><methodResponse><params><param><value><struct>${members}</struct></value></param></params></methodResponse>`;
}

/** Parse a methodResponse struct into a plain object. */
export function parseResponse(xml) {
  const out = {};
  const re = /<member>\s*<name>([^<]+)<\/name>\s*<value>\s*(?:<(string|int|i4|dateTime\.iso8601)>([\s\S]*?)<\/\2>|([^<]*))\s*<\/value>\s*<\/member>/g;
  let m;
  while ((m = re.exec(xml))) {
    const type = m[2] || 'string';
    const raw = decode(m[3] ?? m[4] ?? '');
    out[m[1]] = ['int', 'i4'].includes(type) ? parseInt(raw, 10) : raw;
  }
  if (/<fault>/.test(xml)) out.fault = true;
  return out;
}

/** XML-RPC date format used in Paymentology examples: YYYYMMDDTHH:MM:SS (UTC). */
export function xmlDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** KLV: 3-digit key, 2-digit length, value. Returns { '026': '5541', … }. Unknown keys are kept. */
export function parseKlv(s) {
  const out = {};
  let i = 0;
  const str = String(s || '');
  while (i + 5 <= str.length) {
    const key = str.slice(i, i + 3);
    const len = parseInt(str.slice(i + 3, i + 5), 10);
    if (!/^\d{3}$/.test(key) || Number.isNaN(len)) break;
    out[key] = str.slice(i + 5, i + 5 + len);
    i += 5 + len;
  }
  return out;
}

export function buildKlv(fields) {
  return Object.entries(fields).map(([k, v]) => `${k.padStart(3, '0')}${String(v.length).padStart(2, '0')}${v}`).join('');
}
