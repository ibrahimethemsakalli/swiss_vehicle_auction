import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createDatabaseClient } from '../src/lib/database-client';

export function localDatabase(value: string, restoring = false) {
  const url = new URL(value);
  if (
    process.env.NODE_ENV === 'production' ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  )
    throw new Error('LOCAL_DATABASE_REQUIRED');
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    restoring
      ? !/^autoveri_restore_[a-z0-9_]+_test$/.test(name)
      : !(name === 'autoveri' || /^[a-z0-9_]+_test$/.test(name))
  )
    throw new Error('UNSAFE_DATABASE_NAME');
  return { url, name };
}
export function contained(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  if (
    !rel ||
    rel.startsWith(`..${sep}`) ||
    rel === '..' ||
    rel.startsWith(sep) ||
    /^[A-Za-z]:/.test(rel)
  )
    throw new Error('UNSAFE_PATH');
  return resolve(path);
}
export async function checksum(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
type FileRecord = { path: string; bytes: number; sha256: string };
type Manifest = {
  version: 1;
  createdAt: string;
  database: string;
  files: FileRecord[];
  mediaIncluded: boolean;
};
function pgBinary(tool: 'pg_dump' | 'pg_restore') {
  return join(
    resolve(process.env.PG_BIN ?? '.local/pg-tools'),
    tool + (process.platform === 'win32' ? '.exe' : ''),
  );
}
async function pg(tool: 'pg_dump' | 'pg_restore', url: URL, name: string, args: string[]) {
  const binary = pgBinary(tool);
  await stat(binary).catch(() => {
    throw new Error('PG_TOOLS_REQUIRED_SET_PG_BIN');
  });
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: name,
    PGCONNECT_TIMEOUT: '5',
    PGAPPNAME: 'autoveri-local-backup',
    PGSSLMODE: 'disable',
  };
  await new Promise<void>((done, reject) => {
    const child = spawn(binary, args, { env, shell: false, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PG_TOOL_TIMEOUT'));
    }, 300000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('PG_TOOL_START_FAILED'));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? done() : reject(new Error('PG_TOOL_FAILED'));
    });
  });
}
async function collect(root: string, folder: string, records: FileRecord[], prefix = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const source = contained(root, join(folder, entry.name));
    if (entry.isSymbolicLink()) throw new Error('SYMLINK_NOT_ALLOWED');
    if (entry.isDirectory())
      await collect(root, source, records, prefix ? `${prefix}/${entry.name}` : entry.name);
    else if (entry.isFile()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const size = await stat(source);
      records.push({ path, bytes: size.size, sha256: await checksum(source) });
    } else throw new Error('SPECIAL_FILE_NOT_ALLOWED');
  }
}
async function assertOrdinaryDirectory(path: string) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    resolve(await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()
  )
    throw new Error('SYMLINK_NOT_ALLOWED');
}

export async function backupLocal(options: {
  databaseUrl: string;
  uploads: string;
  quiesced: boolean;
  databaseOnly?: boolean;
}) {
  if (!options.quiesced) throw new Error('STOP_APP_AND_WORKERS_THEN_USE_QUIESCED');
  const { url, name } = localDatabase(options.databaseUrl);
  const root = resolve('.local/backups');
  await mkdir(root, { recursive: true });
  await assertOrdinaryDirectory(root);
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const staging = contained(root, join(root, `${id}.incomplete`));
  const final = contained(root, join(root, id));
  await mkdir(staging);
  const dump = join(staging, 'database.dump');
  await pg('pg_dump', url, name, [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    dump,
  ]);
  const records: FileRecord[] = [
    { path: 'database.dump', bytes: (await stat(dump)).size, sha256: await checksum(dump) },
  ];
  if (!options.databaseOnly) {
    const uploads = resolve(options.uploads);
    await assertOrdinaryDirectory(uploads);
    const photos: FileRecord[] = [];
    await collect(uploads, uploads, photos);
    await mkdir(join(staging, 'uploads'));
    for (const photo of photos) {
      const destination = contained(staging, join(staging, 'uploads', photo.path));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(contained(uploads, join(uploads, photo.path)), destination);
      if ((await checksum(destination)) !== photo.sha256)
        throw new Error('MEDIA_CHANGED_DURING_BACKUP');
      records.push({ ...photo, path: `uploads/${photo.path}` });
    }
  }
  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    database: name,
    files: records,
    mediaIncluded: !options.databaseOnly,
  };
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(staging, final);
  return final;
}
export async function verifyBackup(folder: string) {
  const root = resolve(folder);
  if (basename(root).endsWith('.incomplete')) throw new Error('INCOMPLETE_BACKUP');
  await assertOrdinaryDirectory(root);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Manifest;
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    typeof manifest.mediaIncluded !== 'boolean' ||
    manifest.files.length < 1 ||
    manifest.files[0].path !== 'database.dump'
  )
    throw new Error('INVALID_MANIFEST');
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (
      typeof file.path !== 'string' ||
      !/^(database\.dump|uploads\/[a-zA-Z0-9_.\/-]+)$/.test(file.path) ||
      file.path.split('/').includes('..') ||
      paths.has(file.path)
    )
      throw new Error('INVALID_MANIFEST');
    paths.add(file.path);
    const path = contained(root, join(root, file.path));
    if (
      resolve(await realpath(path)).toLowerCase() !== path.toLowerCase() ||
      (await lstat(path)).isSymbolicLink()
    )
      throw new Error('SYMLINK_NOT_ALLOWED');
    const info = await stat(path);
    if (!info.isFile() || info.size !== file.bytes || (await checksum(path)) !== file.sha256)
      throw new Error('BACKUP_CHECKSUM_MISMATCH');
  }
  return manifest;
}
export async function assertEmptyRestoreDatabase(client: PrismaClient) {
  const [row] = await client.$queryRaw<{ count: bigint }[]>`
    SELECT (
      (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema') +
      (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema') +
      (SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema') +
      (SELECT COUNT(*) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema'))
    ) AS count`;
  if (Number(row.count) !== 0) throw new Error('RESTORE_DATABASE_MUST_BE_EMPTY');
}
export async function restoreLocal(options: {
  folder: string;
  databaseUrl: string;
  uploads: string;
  quiesced: boolean;
}) {
  if (!options.quiesced) throw new Error('STOP_APP_AND_WORKERS_THEN_USE_QUIESCED');
  const { url, name } = localDatabase(options.databaseUrl, true);
  const manifest = await verifyBackup(options.folder);
  if (name === manifest.database) throw new Error('SOURCE_TARGET_MUST_DIFFER');
  const restoreRoot = resolve('.local/restores');
  await mkdir(restoreRoot, { recursive: true });
  await assertOrdinaryDirectory(restoreRoot);
  const uploads = contained(restoreRoot, resolve(options.uploads));
  if (dirname(uploads) !== restoreRoot)
    throw new Error('RESTORE_UPLOAD_TARGET_MUST_BE_DIRECT_CHILD');
  if (
    await lstat(uploads).then(
      () => true,
      () => false,
    )
  )
    throw new Error('RESTORE_UPLOAD_TARGET_MUST_NOT_EXIST');
  // Reserve the destination before touching the database; no overwrite or --clean option exists.
  await mkdir(uploads);
  const client = createDatabaseClient(options.databaseUrl);
  try {
    await assertEmptyRestoreDatabase(client);
    for (const file of manifest.files.filter((f) => f.path.startsWith('uploads/'))) {
      const target = contained(uploads, join(uploads, file.path.slice(8)));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(
        contained(resolve(options.folder), join(resolve(options.folder), file.path)),
        target,
      );
      if ((await checksum(target)) !== file.sha256) throw new Error('BACKUP_CHECKSUM_MISMATCH');
    }
    await pg('pg_restore', url, name, [
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '--exit-on-error',
      '--dbname',
      name,
      resolve(options.folder, 'database.dump'),
    ]);
  } finally {
    await client.$disconnect();
  }
  return { database: name, uploads, mediaIncluded: manifest.mediaIncluded };
}
