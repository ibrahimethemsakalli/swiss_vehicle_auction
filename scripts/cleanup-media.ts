import 'dotenv/config';
import { db } from '../src/lib/db';
import { cleanupMedia } from '../src/lib/media';
const allowed = new Set(['--apply']);
if (process.argv.slice(2).some((arg) => !allowed.has(arg)))
  throw Error('Usage: cleanup-media.ts [--apply]');
cleanupMedia({ apply: process.argv.includes('--apply') })
  .then((result) =>
    console.log(
      JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', ...result }),
    ),
  )
  .catch(() => {
    console.error('Media cleanup failed.');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
