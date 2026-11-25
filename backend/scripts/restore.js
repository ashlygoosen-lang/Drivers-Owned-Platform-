// Usage: npm run restore -- <backup-file> <empty-target-folder>   (needs BACKUP_KEY)
// Then start the server with DATA_DIR=<target-folder> (and the same FILE_ENCRYPTION_KEY) to check it.
import { restoreBackup } from '../src/backup.js';
const [file, target] = process.argv.slice(2);
if (!file || !target) { console.error('Usage: npm run restore -- <backup-file> <empty-target-folder>'); process.exit(1); }
restoreBackup(file, target);
console.log(`Restored into ${target}. Start the server with DATA_DIR=${target} to verify.`);
