import fs from 'node:fs';
import { PORT, FRONTEND_DIST } from './config.js';
import { db } from './db.js';
import { createApp, seedAdmin } from './app.js';
import { seedDemo, demoEnabled } from './demo.js';
import { startDemoSimulator } from './tracking/simulator.js';

await seedAdmin();
await seedDemo();
if (demoEnabled()) startDemoSimulator(); // moves the demo driver's car on the live map
if (demoEnabled()) console.warn('[drop] DEMO MODE IS ON: one-click demo logins are available. Set DEMO_MODE=false before real customers use the site.');
const app = createApp();
const server = app.listen(PORT, () => console.log(`[drop] API listening on :${PORT}${fs.existsSync(FRONTEND_DIST) ? ' (serving frontend)' : ''}`));
const shutdown = () => server.close(async () => { await db.flush(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
