import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalProxyEnvironment } from '../src/lib/local-proxy-engine';
const env = { NODE_ENV: 'test', LOCAL_PROXY_ENGINE: 'true' };
test('local proxy refuses production, remote databases, URL overrides and real provider credentials', () => {
  assert.doesNotThrow(() =>
    assertLocalProxyEnvironment('postgresql://localhost/autoveri?schema=public', env),
  );
  assert.throws(
    () => assertLocalProxyEnvironment('postgresql://localhost/autoveri?schema=other', env),
    /LOCAL_PROXY_DISABLED/,
  );
  assert.doesNotThrow(() =>
    assertLocalProxyEnvironment('postgresql://localhost/autoveri_pm25d_test', env),
  );
  for (const url of [
    'postgresql://remote.test/autoveri',
    'postgresql://localhost/production',
    'postgresql://localhost/autoveri?host=remote.test',
    'postgresql://localhost/autoveri#x',
    'https://localhost/autoveri',
    'invalid',
  ])
    assert.throws(() => assertLocalProxyEnvironment(url, env), /LOCAL_PROXY_DISABLED/);
  for (const override of [
    { NODE_ENV: 'production' },
    { LOCAL_PROXY_ENGINE: 'false' },
    { STRIPE_SECRET_KEY: 'not-a-real-key' },
    { TWILIO_AUTH_TOKEN: 'not-a-real-key' },
    { DATATRANS_KEY: 'not-a-real-key' },
    { STRIPE_ALLOW_LIVE: 'true' },
  ])
    assert.throws(
      () => assertLocalProxyEnvironment('postgresql://localhost/autoveri', { ...env, ...override }),
      /LOCAL_PROXY_DISABLED/,
    );
});
