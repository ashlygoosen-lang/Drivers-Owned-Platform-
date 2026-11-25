import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DATA_DIR } from './config.js';
import { db } from './db.js';

/**
 * Encrypted backups (Phase 4, layer 9).
 * A backup is a gzip tar of the data folder (database plus encrypted KYC documents), encrypted
 * again with AES-256-GCM under BACKUP_KEY, which is held separately from FILE_ENCRYPTION_KEY.
 * Copies are kept on the volume (BACKUP_KEEP, default 14) and, when BACKUP_S3_* is set, uploaded
 * to an S3-compatible bucket (Railway Buckets, Cloudflare R2, AWS S3) so a lost volume can be rebuilt.
 *
 *   npm run backup                       # one backup now
 *   npm run restore -- <file> <target>   # decrypt and unpack into an empty folder
 *
 * Phase 6 replaces the data file with managed Postgres (point-in-time recovery). This keeps
 * protecting the KYC documents.
 */
const MAGIC = Buffer.from('DROPBK1');
const keyFrom = (k) => crypto.createHash('sha256').update(`drop-backup:${k}`).digest();

export function encryptBackup(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(key), iv, { authTagLength: 16 });
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
export function decryptBackup(buf, key) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a DROP backup file.');
  const o = MAGIC.length;
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(key), buf.subarray(o, o + 12), { authTagLength: 16 });
  d.setAuthTag(buf.subarray(o + 12, o + 28));
  return Buffer.concat([d.update(buf.subarray(o + 28)), d.final()]);
}

/** Minimal AWS Signature V4 PUT for S3-compatible storage. */
async function s3Put(name, body) {
  const endpoint = new URL(process.env.BACKUP_S3_ENDPOINT);
  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.BACKUP_S3_REGION || 'auto';
  const key = `${(process.env.BACKUP_S3_PREFIX || 'drop-backups').replace(/\/$/, '')}/${name}`;
  const host = endpoint.host;
  const pathname = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signed = Object.keys(headers).sort();
  const canonical = ['PUT', pathname, '', ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  const hmac = (k, v) => crypto.createHmac('sha256', k).update(v).digest();
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${process.env.BACKUP_S3_SECRET_KEY}`, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  const res = await fetch(`${endpoint.origin}${pathname}`, {
    method: 'PUT',
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${process.env.BACKUP_S3_ACCESS_KEY}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`, 'content-type': 'application/octet-stream' },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Backup upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return key;
}

export async function runBackup({ dataDir = DATA_DIR, key = process.env.BACKUP_KEY, outDir = process.env.BACKUP_DIR || path.join(dataDir, 'backups') } = {}) {
  if (!key) throw new Error('Set BACKUP_KEY (a long random secret kept outside Railway too) to make backups.');
  await db.flush?.();
  fs.mkdirSync(outDir, { recursive: true });
  const rel = path.relative(dataDir, outDir);
  const tar = execFileSync('tar', ['-czf', '-', '-C', dataDir, ...(rel && !rel.startsWith('..') ? [`--exclude=./${rel}`] : []), '.'], { maxBuffer: 2 * 1024 ** 3 });
  const enc = encryptBackup(tar, key);
  const name = `drop-${new Date().toISOString().replace(/[:.]/g, '-')}.dropbk`;
  const file = path.join(outDir, name);
  fs.writeFileSync(file, enc, { mode: 0o600 });
  // Keep the newest BACKUP_KEEP copies on the volume.
  const keep = Number(process.env.BACKUP_KEEP || 14);
  const all = fs.readdirSync(outDir).filter((f) => f.endsWith('.dropbk')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(path.join(outDir, old));
  let remote = null;
  if (process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET) remote = await s3Put(name, enc);
  return { file, bytes: enc.length, remote, sha256: crypto.createHash('sha256').update(enc).digest('hex') };
}

export function restoreBackup(file, target, key = process.env.BACKUP_KEY) {
  if (!key) throw new Error('BACKUP_KEY is required to restore.');
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`Restore target ${target} must be empty.`);
  fs.mkdirSync(target, { recursive: true });
  const tar = decryptBackup(fs.readFileSync(file), key);
  execFileSync('tar', ['-xzf', '-', '-C', target], { input: tar, maxBuffer: 2 * 1024 ** 3 });
  return target;
}
