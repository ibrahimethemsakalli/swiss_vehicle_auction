import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ciEnvironment } from './ci-environment.mjs';

const [check, ...selected] = process.argv.slice(2);
const env = ciEnvironment(
  process.env,
  check === 'db' ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '') : '',
);
let args;
const typeReferenceSnapshot = existsSync('next-env.d.ts')
  ? readFileSync('next-env.d.ts', 'utf8')
  : null;
function restoreTypeReferences() {
  if (
    typeReferenceSnapshot !== null &&
    existsSync('next-env.d.ts') &&
    readFileSync('next-env.d.ts', 'utf8').includes('./.local/next-ci-build/types/')
  )
    writeFileSync('next-env.d.ts', typeReferenceSnapshot);
}
switch (check) {
  case 'typecheck':
    env.CI_BUILD = 'true';
    {
      const generated = spawnSync(
        process.execPath,
        ['node_modules/next/dist/bin/next', 'typegen'],
        { env, stdio: 'inherit', shell: false, windowsHide: true },
      );
      if (generated.status !== 0) {
        restoreTypeReferences();
        process.exit(generated.status ?? 1);
      }
    }
    args = ['node_modules/typescript/bin/tsc', '--noEmit', '--project', 'tsconfig.ci.json'];
    break;
  case 'build':
    args = ['node_modules/next/dist/bin/next', 'build', '--webpack'];
    env.NODE_ENV = 'production';
    // Separate output from an existing local preview/build.
    env.CI_BUILD = 'true';
    break;
  case 'unit': {
    const files = readdirSync('tests').filter((name) => name.endsWith('.test.ts'));
    if (selected.some((name) => !files.includes(name))) throw new Error('Unknown unit test file');
    args = [
      '--import',
      pathToFileURL(resolve('scripts/ci-no-network.mjs')).href,
      '--import',
      'tsx',
      '--test',
      ...(selected.length ? selected : files).map((name) => `tests/${name}`),
    ];
    // The test runner spawns isolated workers; preload the same guard there.
    env.NODE_OPTIONS = `--import=${pathToFileURL(resolve('scripts/ci-no-network.mjs')).href}`;
    break;
  }
  case 'db':
    args = ['--import', 'tsx', 'scripts/ci-schema-check.ts'];
    break;
  default:
    throw new Error('Use: ci-check.mjs typecheck|unit [FILE.test.ts ...]|build|db');
}
if (check !== 'unit' && selected.length) throw new Error('Unexpected arguments');
const child = spawn(process.execPath, args, {
  env,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});
child.on('error', () => {
  restoreTypeReferences();
  console.error('CI_CHECK_START_FAILED');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  restoreTypeReferences();
  process.exitCode = code ?? (signal ? 1 : 0);
});
