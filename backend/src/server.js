import fs from 'node:fs';
import { PORT, FRONTEND_DIST } from './config.js';
import { db, initDb, instanceId } from './db.js';
import { initKv } from './kv.js';
import { initErrorTracking, securityEvent, log } from './monitor.js';

/**
 * Start-up order matters: Redis (shared limits, locks, events) → data store (Postgres or file) →
 * app. Every instance serves traffic; one instance (the leader) also runs the scheduled jobs.
 */
await initKv();
await initDb();
await initErrorTracking();

const { createApp, seedAdmin } = await import('./app.js');
const { seedDemo, demoEnabled } = await import('./demo.js');
const { startDemoSimulator } = await import('./tracking/simulator.js');
const { pruneSessions } = await import('./sessions.js');
const { verifyAuditChain } = await import('./kyc.js');
const { runBackup } = await import('./backup.js');
const { purgeExpiredKyc } = await import('./routes/account.js');
const { reconcile } = await import('./reconcile.js');
const { startLeaderElection, isLeader } = await import('./lock.js');

await seedAdmin();
await seedDemo();
if (demoEnabled()) console.warn('[drop] DEMO MODE IS ON. It switches itself off when the first real customer signs up (demo staff dashboards are never available once real users exist). Set DEMO_MODE=false to turn it off now.');

const app = createApp();
const server = app.listen(PORT, () => console.log(`[drop] API listening on :${PORT}${fs.existsSync(FRONTEND_DIST) ? ' (serving frontend)' : ''} · instance ${instanceId}`));
// Slow-request protection: drop clients that trickle headers or bodies (slowloris-style attacks).
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 65_000; // longer than common load-balancer idle timeouts

/* ---- scheduled jobs: leader only ---- */
const daily = () => {
  if (!isLeader()) return;
  pruneSessions();
  const purged = purgeExpiredKyc();
  if (purged) securityEvent('kyc_retention_purge', { records: String(purged) });
  const check = verifyAuditChain();
  if (!check.ok) securityEvent('audit_chain_broken', { at: String(check.brokenAt), id: check.id }, 'high');
  if (process.env.BACKUP_KEY) {
    runBackup().then((r) => securityEvent('backup_completed', { bytes: String(r.bytes), remote: String(Boolean(r.remote)) }))
      .catch((err) => securityEvent('backup_failed', { error: err.message.slice(0, 200) }, 'high'));
  } else if (process.env.NODE_ENV === 'production' && !db.usingPostgres()) securityEvent('backup_not_configured', {}, 'medium');
};
let simulator = null;
startLeaderElection((leading) => {
  log('info', leading ? 'This instance is now the job leader' : 'This instance is no longer the job leader', { instance: instanceId });
  if (leading && demoEnabled() && !simulator) simulator = startDemoSimulator();
  if (!leading && simulator) { clearInterval(simulator); simulator = null; }
});
setTimeout(daily, 60_000).unref();
setInterval(daily, 24 * 3_600_000).unref();
setInterval(() => { if (isLeader()) reconcile().catch((err) => securityEvent('reconciliation_failed', { error: err.message.slice(0, 160) }, 'high')); }, 60_000).unref();

/* ---- graceful shutdown: stop taking traffic, let requests finish, flush writes ---- */
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('info', `Shutting down (${signal})`, { instance: instanceId });
  app.locals.draining = true; // /api/ready answers 503 so the load balancer stops sending traffic
  server.close();
  setTimeout(() => server.closeAllConnections(), 10_000).unref(); // live streams reconnect to another instance
  setTimeout(async () => { await db.close().catch(() => undefined); process.exit(0); }, 11_000).unref();
  server.on('close', async () => { await db.close().catch(() => undefined); process.exit(0); });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
