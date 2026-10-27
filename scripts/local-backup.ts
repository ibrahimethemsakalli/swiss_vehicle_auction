import 'dotenv/config';
import { backupLocal, restoreLocal, verifyBackup } from './local-backup-lib';

async function main() {
  const [action, folder, ...flags] = process.argv.slice(2);
  if (action === 'create') {
    const options = [folder, ...flags].filter(Boolean);
    if (options.some((v) => !['--quiesced', '--database-only'].includes(v)))
      throw new Error('INVALID_ARGUMENTS');
    console.log(
      await backupLocal({
        databaseUrl: process.env.DATABASE_URL ?? '',
        uploads: process.env.UPLOAD_DIR ?? '.uploads',
        quiesced: options.includes('--quiesced'),
        databaseOnly: options.includes('--database-only'),
      }),
    );
  } else if (action === 'verify' && folder && flags.length === 0) {
    const manifest = await verifyBackup(folder);
    console.log(
      `Verified ${manifest.files.length} files; media included: ${manifest.mediaIncluded}`,
    );
  } else if (action === 'restore' && folder && flags.length === 1 && flags[0] === '--quiesced') {
    console.log(
      await restoreLocal({
        folder,
        databaseUrl: process.env.RESTORE_DATABASE_URL ?? '',
        uploads: process.env.RESTORE_UPLOAD_DIR ?? '',
        quiesced: true,
      }),
    );
  } else
    throw new Error(
      'Use: create --quiesced [--database-only] | verify FOLDER | restore FOLDER --quiesced',
    );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'BACKUP_FAILED');
  process.exitCode = 1;
});
