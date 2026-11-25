// Usage: npm run backup   (needs BACKUP_KEY; DATA_DIR as for the server)
import { runBackup } from '../src/backup.js';
const r = await runBackup();
console.log(`Backup written: ${r.file} (${(r.bytes / 1024).toFixed(0)} KB, sha256 ${r.sha256.slice(0, 16)}…)${r.remote ? `, uploaded to ${r.remote}` : ''}`);
process.exit(0);
