import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'next-auth/jwt';
import { socketToken, socketOriginAllowed } from '../src/lib/socket-auth';
test('socket authentication reads raw and chunked session cookies and rejects invalid tokens', async () => {
  const secret = 'local-unit-test-secret';
  const token = await encode({ token: { sub: 'test-user', authVersion: 3 }, secret });
  const midpoint = Math.floor(token.length / 2);
  const parsed = await socketToken(
    {
      cookie: `next-auth.session-token.1=${token.slice(midpoint)}; next-auth.session-token.0=${token.slice(0, midpoint)}`,
    },
    'http://localhost:3000',
    secret,
  );
  assert.equal(parsed?.sub, 'test-user');
  assert.equal(parsed?.authVersion, 3);
  assert.equal(
    (
      await socketToken(
        { cookie: `__Secure-next-auth.session-token=${token}` },
        'https://example.com',
        secret,
      )
    )?.sub,
    'test-user',
  );
  assert.equal(
    await socketToken({ cookie: 'next-auth.session-token=bad' }, 'http://localhost:3000', secret),
    null,
  );
});
test('socket origin permits same-origin polling referer, rejects missing or foreign origins', () => {
  const origin = 'http://localhost:3000';
  assert.equal(socketOriginAllowed({ referer: origin + '/vehicles/1' }, origin), true);
  assert.equal(socketOriginAllowed({ origin }, origin), true);
  assert.equal(socketOriginAllowed({}, origin), false);
  assert.equal(
    socketOriginAllowed({ origin: 'https://evil.example', referer: origin }, origin),
    false,
  );
});
