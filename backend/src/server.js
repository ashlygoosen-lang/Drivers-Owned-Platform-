import fs from 'node:fs';
import { PORT, FRONTEND_DIST } from './config.js';
import { db } from './db.js';
import { createApp, seedAdmin } from './app.js';

await seedAdmin();
const app = createApp();
const server = app.listen(PORT, () => console.log(`[drop] API listening on :${PORT}${fs.existsSync(FRONTEND_DIST) ? ' (serving frontend)' : ''}`));
const shutdown = () => server.close(async () => { await db.flush(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
