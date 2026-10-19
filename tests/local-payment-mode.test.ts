import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localPaymentsEnabled, assertLocalRequest, localGateway } from '../src/lib/local-payment';
test('local payments fail closed for production, remote hosts, real keys and absent opt-in', async () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, {
      LOCAL_TEST_PAYMENTS: 'true',
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/autoveri',
      NEXTAUTH_URL: 'http://localhost:3000',
      HOST: '127.0.0.1',
      STRIPE_SECRET_KEY: '',
    });
    assert.equal(localPaymentsEnabled(), true);
    assert.throws(
      () => assertLocalRequest(new Request('https://example.com/api/local-test')),
      /FORBIDDEN/,
    );
    for (const [key, value] of Object.entries({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db.example.com/autoveri',
      NEXTAUTH_URL: 'https://example.com',
      HOST: '0.0.0.0',
      STRIPE_SECRET_KEY: 'sk_test_anything',
      LOCAL_TEST_PAYMENTS: 'false',
    })) {
      const before = process.env[key];
      process.env[key] = value;
      assert.equal(localPaymentsEnabled(), false, key);
      process.env[key] = before;
    }
    process.env.LOCAL_TEST_PAYMENTS = 'false';
    await assert.rejects(() => localGateway.retrieve('local_disabled'), /FORBIDDEN/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
