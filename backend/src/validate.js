/** Tiny validation helpers that throw 400s with human-friendly messages. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);

export function str(value, label, { min = 1, max = 500, optional = false } = {}) {
  const v = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (!v) {
    if (optional) return '';
    throw bad(`${label} is required.`);
  }
  if (v.length < min) throw bad(`${label} must be at least ${min} characters.`);
  if (v.length > max) throw bad(`${label} must be at most ${max} characters.`);
  return v;
}

export function email(value, label = 'Email address') {
  const v = str(value, label, { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw bad(`Please enter a valid ${label.toLowerCase()}.`);
  return v;
}

export function phone(value, label = 'Mobile number', optional = false) {
  const v = str(value, label, { max: 20, optional });
  if (!v) return v;
  const digits = v.replace(/[^\d+]/g, '');
  if (!/^\+?\d{9,15}$/.test(digits)) throw bad(`Please enter a valid ${label.toLowerCase()}.`);
  return digits;
}

export function oneOf(value, list, label) {
  if (!list.includes(value)) throw bad(`Please choose a valid ${label.toLowerCase()}.`);
  return value;
}

export function int(value, label, { min = 0, max = 1e9 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be between ${min} and ${max}.`);
  return n;
}

export function password(value) {
  const v = typeof value === 'string' ? value : '';
  if (v.length < 8) throw bad('Password must be at least 8 characters.');
  if (v.length > 128) throw bad('Password is too long.');
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) throw bad('Password must include letters and numbers.');
  return v;
}

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
