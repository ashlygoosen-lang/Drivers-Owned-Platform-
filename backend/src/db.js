import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, UPLOAD_DIR } from './config.js';

/**
 * Small JSON-file datastore. Every write is atomic (temp file + rename), writes are
 * serialised, and the whole dataset lives in memory for fast reads. Fine for a launch-stage
 * site; swap for Postgres by reimplementing this module's exports.
 */
const FILE = path.join(DATA_DIR, 'drop-db.json');

const EMPTY = {
  users: [],
  bookings: [],
  applications: [],
  tickets: [],
  enquiries: [],
  verifications: [],
  ledger: [],
  cards: [],
  cardEvents: [],
  withdrawals: [],
  payments: [],
  notifications: [],
  audit: [],
  messages: [],
  calls: [],
  counters: { booking: 1000, application: 100, ticket: 100, enquiry: 100, withdrawal: 1000, wallet: 0 },
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let data = structuredClone(EMPTY);
if (fs.existsSync(FILE)) {
  try {
    data = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    data.counters = { ...EMPTY.counters, ...data.counters };
  } catch (err) {
    const backup = `${FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(FILE, backup);
    console.error(`[drop] Could not read ${FILE}; a copy was kept at ${backup}. Starting with an empty store.`, err);
  }
}

let queue = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(data, null, 2);
  queue = queue.then(async () => {
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, FILE);
  }).catch((err) => console.error('[drop] Failed to save data', err));
  return queue;
}

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function nextRef(kind, prefix) {
  data.counters[kind] = (data.counters[kind] || 0) + 1;
  return `${prefix}-${data.counters[kind]}`;
}

export const db = {
  get: () => data,
  all: (collection) => data[collection],
  find: (collection, predicate) => data[collection].find(predicate),
  filter: (collection, predicate) => data[collection].filter(predicate),
  insert(collection, record) {
    data[collection].push(record);
    persist();
    return record;
  },
  update(collection, recordId, patch) {
    const record = data[collection].find((r) => r.id === recordId);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: now() });
    persist();
    return record;
  },
  save: persist,
  flush: () => queue,
};
