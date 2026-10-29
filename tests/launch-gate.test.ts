import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enforceProductionLaunch,
  launchEnvironmentIssues,
  localLaunchFlags,
  type LaunchEnv,
} from '../src/lib/launch-gate';
import { indexingEnabled } from '../src/lib/seo';
import { readLaunchDatabase } from '../src/lib/launch-database';
import {
  legalHash,
  draftContent,
  legalProfile,
  profileFields,
  type LegalProfile,
} from '../src/lib/legal-policy';
import type { PrismaClient } from '../src/generated/prisma/client';

const env: LaunchEnv = {
  NODE_ENV: 'production',
  LAUNCH_MODE: 'public',
  LAUNCH_LEGAL_VERSION: 'synthetic-v1',
  PUBLIC_SITE_URL: 'https://synthetic.autoveri.ch',
  NEXTAUTH_URL: 'https://synthetic.autoveri.ch',
  NEXTAUTH_SECRET: 'synthetic-key-for-unit-test-only-0123456789',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1/db',
  UPLOAD_DIR: '/private/uploads',
  SEO_INDEXING_ENABLED: 'true',
  ...Object.fromEntries(localLaunchFlags.map((key) => [key, 'false'])),
};
test('public gate rejects unsafe or ambiguous flags and missing configuration without disclosing values', async () => {
  assert.deepEqual(launchEnvironmentIssues(env), []);
  for (const key of localLaunchFlags)
    for (const value of ['true', 'TRUE', '', undefined]) {
      const bad = { ...env, [key]: value };
      assert.ok(launchEnvironmentIssues(bad).includes(`${key}_MUST_BE_FALSE`));
      assert.equal(indexingEnabled(bad), false);
    }
  for (const key of [
    'LAUNCH_MODE',
    'LAUNCH_LEGAL_VERSION',
    'NEXTAUTH_SECRET',
    'DATABASE_URL',
    'UPLOAD_DIR',
    'PUBLIC_SITE_URL',
  ]) {
    const issues = launchEnvironmentIssues({ ...env, [key]: '' });
    assert.ok(issues.length, key);
    assert.ok(!JSON.stringify(issues).includes(env.NEXTAUTH_SECRET!));
  }
  assert.equal(indexingEnabled({ ...env, NEXTAUTH_URL: 'https://different.autoveri.ch' }), false);
  assert.equal(indexingEnabled({ ...env, LAUNCH_LEGAL_VERSION: 'draft-1' }), false);
  let calls = 0;
  await assert.rejects(
    enforceProductionLaunch({ ...env, LOCAL_TEST_PAYMENTS: 'true' }, async () => {
      calls++;
      return { issues: [] };
    }),
    /LAUNCH_BLOCKED/,
  );
  assert.equal(calls, 0);
});
test('startup checks DB before public mode; unavailable evidence fails closed and dev is unchanged', async () => {
  await enforceProductionLaunch(env, async () => ({ issues: [] }));
  await assert.rejects(
    enforceProductionLaunch(env, async () => ({ issues: ['SYNTHETIC_DATA_sampleUsers'] })),
    /SYNTHETIC_DATA/,
  );
  await assert.rejects(
    enforceProductionLaunch(env, async () => {
      throw Error('secret-url');
    }),
    (error: Error) => error.message === 'LAUNCH_BLOCKED: DATABASE_CHECK_FAILED',
  );
  await enforceProductionLaunch({ NODE_ENV: 'development' }, async () => {
    throw Error('must not read');
  });
});
test('production preview is explicit, loopback-only and cannot start workers, use secrets or index', async () => {
  const preview = {
    ...env,
    LAUNCH_MODE: 'preview',
    HOST: '127.0.0.1',
    NEXTAUTH_URL: 'http://127.0.0.1:3100',
    BACKGROUND_WORKERS_ENABLED: 'false',
    SEO_INDEXING_ENABLED: 'false',
  };
  await enforceProductionLaunch(preview, async () => {
    throw Error('no public DB check');
  });
  assert.equal(indexingEnabled(preview), false);
  for (const change of [
    { HOST: '0.0.0.0' },
    { BACKGROUND_WORKERS_ENABLED: 'true' },
    { SEO_INDEXING_ENABLED: 'true' },
    { STRIPE_SECRET_KEY: 'synthetic' },
    { EMAIL_SERVER: 'smtp://synthetic:synthetic@localhost' },
  ]) {
    await assert.rejects(
      enforceProductionLaunch({ ...preview, ...change }, async () => ({ issues: [] })),
      /LAUNCH_BLOCKED/,
    );
  }
});
test('database check reads consistent evidence, rejects fixtures, unpublished or corrupt legal text; never writes', async () => {
  const profile = {
    ...legalProfile,
    ...Object.fromEntries(profileFields.map((k) => [k, 'SYNTHETIC TEST ONLY'])),
    readyForPublication: true,
    domain: env.PUBLIC_SITE_URL,
    supportEmail: 'support@example.test',
    privacyEmail: 'privacy@example.test',
  } as LegalProfile;
  const documents = ['de', 'fr', 'it', 'en'].flatMap((locale) =>
    ['TERMS', 'PRIVACY'].map((kind) => {
      const content = draftContent(kind as 'TERMS' | 'PRIVACY', locale as 'de', profile);
      return { locale, kind, content, contentHash: legalHash(content) };
    }),
  );
  let current: unknown = { release: { version: env.LAUNCH_LEGAL_VERSION, documents } };
  let samples = 0;
  const calls: string[] = [];
  const count = async () => {
    calls.push('count');
    return samples;
  };
  const tx = {
    $executeRawUnsafe: async (sql: string) => {
      assert.equal(sql, 'SET TRANSACTION READ ONLY');
      calls.push('readonly');
    },
    user: { count },
    vehicle: { count },
    paymentHold: { count },
    localProxyAuction: { count },
    refundCaptureState: { count },
    legalCurrent: { findUnique: async () => current },
  };
  const db = {
    $transaction: async (fn: (t: typeof tx) => unknown, options: unknown) => {
      assert.deepEqual(options, { isolationLevel: 'RepeatableRead', timeout: 10000 });
      return fn(tx);
    },
  } as unknown as PrismaClient;
  assert.deepEqual((await readLaunchDatabase(db, env)).issues, []);
  assert.equal(calls[0], 'readonly');
  samples = 1;
  assert.equal((await readLaunchDatabase(db, env)).issues.length, 5);
  samples = 0;
  documents[0].contentHash = 'corrupt';
  assert.ok((await readLaunchDatabase(db, env)).issues.includes('LEGAL_PUBLICATION_INVALID'));
  current = null;
  assert.ok((await readLaunchDatabase(db, env)).issues.includes('LEGAL_PUBLICATION_MISMATCH'));
});
