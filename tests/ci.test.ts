import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ciEnvironment } from '../scripts/ci-environment.mjs';
import { loadYaml, validateWorkflow } from '../scripts/ci-workflow-policy.mjs';

test('CI child environment removes application providers, developer DB and process injection', () => {
  const input = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://FAKE:FAKE@real.example/production',
    STRIPE_SECRET_KEY: 'FAKE_KEY',
    TWILIO_AUTH_TOKEN: 'FAKE_TOKEN',
    NEXTAUTH_SECRET: 'FAKE_SECRET',
    NODE_OPTIONS: '--inspect',
    OPS_INSTANCE_ID: 'FAKE_RUNTIME',
  } as NodeJS.ProcessEnv;
  const output = ciEnvironment(input);
  assert.equal(output.DATABASE_URL, '');
  assert.equal(output.STRIPE_SECRET_KEY, '');
  assert.equal(output.TWILIO_AUTH_TOKEN, '');
  assert.notEqual(output.NEXTAUTH_SECRET, input.NEXTAUTH_SECRET);
  assert.equal(output.NODE_OPTIONS, undefined);
  assert.equal(output.LOCAL_TEST_PAYMENTS, 'false');
  assert.equal(output.OPS_INSTANCE_ID, '');
  assert.equal(input.STRIPE_SECRET_KEY, 'FAKE_KEY');
  assert.equal(input.NODE_OPTIONS, '--inspect');
});
test('CI network guard blocks accidental fetch, HTTP and HTTPS calls', () => {
  const preload = pathToFileURL(resolve('scripts/ci-no-network.mjs')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      preload,
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';import http from 'node:http';import https from 'node:https';await assert.rejects(fetch('https://example.invalid'),/CI_NETWORK_DISABLED/);assert.throws(()=>http.get('http://example.invalid'),/CI_NETWORK_DISABLED/);assert.throws(()=>https.request('https://example.invalid'),/CI_NETWORK_DISABLED/);`,
    ],
    { env: ciEnvironment(), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
test('actual workflow parses and unsafe credential, audit and trigger changes are rejected', () => {
  const workflow = loadYaml('.github/workflows/ci.yml');
  validateWorkflow(workflow);
  const cases = [
    (w: any) => {
      w.permissions.contents = 'write';
    },
    (w: any) => {
      w.on.pull_request_target = {};
    },
    (w: any) => {
      w.jobs.security.steps.at(-1)['continue-on-error'] = true;
    },
    (w: any) => {
      w.jobs.quality.steps[0].uses = 'actions/checkout@main';
    },
    (w: any) => {
      w.jobs.quality.steps[0].with['persist-credentials'] = true;
    },
  ];
  for (const change of cases) {
    const unsafe = structuredClone(workflow);
    change(unsafe);
    assert.throws(() => validateWorkflow(unsafe));
  }
});
