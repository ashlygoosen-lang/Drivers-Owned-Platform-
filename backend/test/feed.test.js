// Change feed never skips a write that commits out of order (PostgreSQL only).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PG = Boolean(process.env.DATABASE_URL);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-feed-'));
Object.assign(process.env, { DATA_DIR: dir, FILE_ENCRYPTION_KEY: 'k', DEMO_MODE: 'false' });
const dbm = await import('../src/db.js');
const { db } = dbm;
before(async () => { await dbm.initDb(); });
after(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a write that commits after a later one is still picked up (no gaps)', { skip: !PG && 'needs PostgreSQL' }, async () => {
  const { default: pg } = await import('pg');
  const a = new pg.Client({ connectionString: process.env.DATABASE_URL }); const b = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await a.connect(); await b.connect();
  try {
    const ins = "insert into drop_docs (collection, id, data) values ('tickets', $1, $2)";
    await a.query('begin');
    await a.query(ins, ['slow', JSON.stringify({ id: 'slow', ref: 'T-SLOW', createdAt: new Date().toISOString() })]); // takes seq N, not committed yet
    await b.query(ins, ['fast', JSON.stringify({ id: 'fast', ref: 'T-FAST', createdAt: new Date().toISOString() })]); // seq N+1, committed
    await dbm.catchUp();
    assert.ok(db.byId('tickets', 'fast'));
    assert.equal(db.byId('tickets', 'slow'), undefined, 'not visible yet');
    await a.query('commit');
    await new Promise((r) => setTimeout(r, 300));
    await dbm.catchUp();
    assert.ok(db.byId('tickets', 'slow'), 'the earlier sequence number is fetched once it commits');
    assert.equal((await db.health()).feedHoles, 0);
  } finally { await a.end(); await b.end(); }
});
