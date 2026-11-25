import fs from 'node:fs';
import { PORT, FRONTEND_DIST } from './config.js';
import { db } from './db.js';
import { createApp, seedAdmin } from './app.js';
import { seedDemo, demoEnabled } from './demo.js';
import { startDemoSimulator } from './tracking/simulator.js';
import { initKv } from './kv.js';
import { initErrorTracking, securityEvent } from './monitor.js';
import { pruneSessions } from './sessions.js';
import { verifyAuditChain } from './kyc.js';
import { runBackup } from './backup.js';
import { purgeExpiredKyc } from './routes/account.js';

await initKv(); // Redis for shared rate limits and lockouts (falls back to memory)
await initErrorTracking();

await seedAdmin();
await seedDemo();
if (demoEnabled()) startDemoSimulator(); // moves the demo driver's car on the live map
if (demoEnabled()) console.warn('[drop] DEMO MODE IS ON. It switches itself off when the first real customer signs up (demo staff dashboards are never available once real users exist). Set DEMO_MODE=false to turn it off now.');
const app = createApp();
const server = app.listen(PORT, () => console.log(`[drop] API listening on :${PORT}${fs.existsSync(FRONTEND_DIST) ? ' (serving frontend)' : ''}`));
// Slow-request protection: drop clients that trickle headers or bodies (slowloris-style attacks).
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 65_000; // longer than common load-balancer idle timeouts
// Daily housekeeping and tamper check of the audit log.
const daily = () => {
  pruneSessions();
  const purged = purgeExpiredKyc();
  if (purged) securityEvent('kyc_retention_purge', { records: String(purged) });
  const check = verifyAuditChain();
  if (!check.ok) securityEvent('audit_chain_broken', { at: String(check.brokenAt), id: check.id }, 'high');
  if (process.env.BACKUP_KEY) {
    runBackup().then((r) => securityEvent('backup_completed', { bytes: String(r.bytes), remote: String(Boolean(r.remote)) }))
      .catch((err) => securityEvent('backup_failed', { error: err.message.slice(0, 200) }, 'high'));
  } else if (process.env.NODE_ENV === 'production') securityEvent('backup_not_configured', {}, 'medium');
};
setTimeout(daily, 60_000).unref();
setInterval(daily, 24 * 3_600_000).unref();
const shutdown = () => server.close(async () => { await db.flush(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
