/**
 * Shared fixture for the multi-instance concurrency tests and the load test: starts N real DROP
 * server processes on one PostgreSQL database and one Redis, and seeds verified drivers and
 * passengers directly in the database (bypassing sign-in limits), with signed session tokens.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SECRET = 'scale-test-secret';
const DRIVER_DOCS = ['id_document', 'proof_of_address', 'selfie', 'drivers_licence', 'prdp', 'vehicle_registration', 'vehicle_insurance'];
const future = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

export async function startCluster({ databaseUrl, redisUrl, instances = 2, basePort = 4810, env = {} }) {
  const procs = [];
  for (let i = 0; i < instances; i++) {
    const port = basePort + i;
    const p = spawn(process.execPath, [path.join(here, '../../src/server.js')], {
      env: {
        ...process.env, PORT: String(port), DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, JWT_SECRET: SECRET, DEMO_MODE: 'false',
        PASSENGER_VERIFICATION: 'off', FRONTEND_DIST: '/nonexistent', LOG_REQUESTS: 'off', RATE_LIMIT_API: '1000000', RATE_LIMIT_BOOKINGS: '1000000',
        NODE_ENV: 'production', PWNED_CHECK: 'off', FILE_ENCRYPTION_KEY: 'scale', DATA_DIR: `/tmp/drop-scale-${port}`, ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    procs.push({ p, port, base: `http://127.0.0.1:${port}/api`, log: () => out });
  }
  // Wait until every instance is ready.
  for (const s of procs) {
    const end = Date.now() + 30_000;
    for (;;) {
      try { const r = await fetch(`${s.base}/ready`); if (r.ok) break; } catch { /* starting */ }
      if (Date.now() > end) throw new Error(`instance ${s.port} did not start:\n${s.log()}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return { instances: procs, stop: async () => { for (const s of procs) s.p.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1500)); for (const s of procs) s.p.kill('SIGKILL'); } };
}

const token = (u) => jwt.sign({ sub: u.id, role: u.role, tv: 0, ep: '1', typ: 'session' }, SECRET, { expiresIn: '2h' });

/** Insert users straight into drop_docs and tell every instance to catch up. */
export async function seed(databaseUrl, { drivers = 0, passengers = 0 }) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const now = new Date().toISOString();
  const out = { drivers: [], passengers: [] };
  const rows = [];
  for (let i = 0; i < drivers; i++) {
    const u = { id: crypto.randomUUID(), name: `Driver ${i}`, email: `driver${i}-${crypto.randomUUID().slice(0, 6)}@scale.test`, phone: '+27820000000', role: 'driver', passwordHash: '!', driverStatus: 'approved', verificationStatus: 'verified', online: true, vehicle: 'Test car', createdAt: now };
    const v = { id: crypto.randomUUID(), userId: u.id, role: 'driver', status: 'verified', decision: 'approved', submittedAt: now, consentAt: now, profile: { legalName: u.name }, history: [], documents: DRIVER_DOCS.map((type) => ({ id: crypto.randomUUID(), type, status: 'approved', expiresAt: future, issuedAt: now.slice(0, 10), uploadedAt: now, file: 'none.bin' })) };
    rows.push(['users', u], ['verifications', v]);
    out.drivers.push({ ...u, token: token(u) });
  }
  for (let i = 0; i < passengers; i++) {
    const u = { id: crypto.randomUUID(), name: `Passenger ${i}`, email: `p${i}-${crypto.randomUUID().slice(0, 6)}@scale.test`, phone: '+27830000000', role: 'passenger', passwordHash: '!', verificationStatus: 'verified', createdAt: now };
    rows.push(['users', u]);
    out.passengers.push({ ...u, token: token(u) });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params = chunk.flatMap(([c, d]) => [c, d.id, JSON.stringify(d)]);
    await client.query(`insert into drop_docs (collection, id, data) values ${chunk.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`).join(',')}`, params);
  }
  await client.query("notify drop_changes, 'seed'");
  await client.end();
  await new Promise((r) => setTimeout(r, 2500)); // every instance catches up (LISTEN, plus the 2 s poll)
  return out;
}

export async function call(base, method, url, { token: t, body, headers = {} } = {}) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}

export async function query(databaseUrl, sql, params = []) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try { return (await client.query(sql, params)).rows; } finally { await client.end(); }
}
