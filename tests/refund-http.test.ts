import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { refundHandlers } from '../src/lib/refund-http';
const body = {
  action: 'request',
  captureId: 'capture',
  requestId: randomUUID(),
  reason: 'A sufficiently detailed reason for review.',
};
function setup(auth = async () => 'session-user', limit = async (_id: string) => {}) {
  const calls: any[] = [];
  const h = refundHandlers(
    {
      list: async (...a: any[]) => {
        calls.push(a);
        return {} as any;
      },
      read: async (...a: any[]) => {
        calls.push(a);
        return {} as any;
      },
      request: async (...a: any[]) => {
        calls.push(a);
        return { id: 'case', status: 'REQUESTED', version: 0 };
      },
      decide: async (...a: any[]) => {
        calls.push(a);
        return { id: 'case', status: 'IN_REVIEW', version: 1 };
      },
    },
    auth,
    limit,
  );
  return { h, calls };
}
const post = (data: unknown, origin = 'http://127.0.0.1:3000') =>
  new Request('http://127.0.0.1:3000/api/refunds', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
test('missing session and cross-origin/missing origin never call service', async () => {
  const { h, calls } = setup(async () => {
    throw Error('UNAUTHORIZED');
  });
  assert.equal((await h.GET(new Request('http://127.0.0.1:3000/api/refunds'))).status, 401);
  assert.equal((await h.POST(post(body))).status, 401);
  const other = setup();
  assert.equal((await other.h.POST(post(body, 'https://other.invalid'))).status, 403);
  const noOrigin = post(body);
  noOrigin.headers.delete('origin');
  assert.equal((await other.h.POST(noOrigin)).status, 403);
  assert.equal(calls.length + other.calls.length, 0);
});
test('session identity is server-owned; extra identity, money and execution actions rejected', async () => {
  const { h, calls } = setup();
  assert.equal((await h.POST(post(body))).status, 200);
  assert.equal(calls[0][0], 'session-user');
  for (const patch of [
    { userId: 'victim' },
    { amountMinor: 1 },
    { approvalIds: ['admin'] },
    { action: 'execute' },
  ])
    assert.equal((await h.POST(post({ ...body, ...patch }))).status, 400);
  assert.equal(calls.length, 1);
});
test('bounded JSON, validation, duplicate queries and rate limit fail closed', async () => {
  const { h, calls } = setup();
  assert.equal((await h.POST(post({ ...body, reason: 'x'.repeat(17000) }))).status, 413);
  assert.equal((await h.POST(post({ ...body, reason: 'short' }))).status, 400);
  assert.equal(
    (await h.GET(new Request('http://127.0.0.1:3000/api/refunds?admin=true&admin=false'))).status,
    400,
  );
  assert.equal((await h.GET(new Request('http://127.0.0.1:3000/api/refunds?page=0'))).status, 400);
  const limited = setup(undefined, async () => {
    throw Error('RATE_LIMITED');
  });
  assert.equal((await limited.h.POST(post(body))).status, 429);
  assert.equal(calls.length, 0);
});
test('responses never cache private data or leak internal errors; conflicts stay explicit', async () => {
  const { h } = setup();
  const r = await h.GET(new Request('http://127.0.0.1:3000/api/refunds?admin=true&page=2'));
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('vary'), 'Cookie');
  for (const [message, status] of [
    ['CONFLICT', 409],
    ['POLICY_UNCONFIGURED', 409],
    ['postgres password=SECRET', 503],
  ] as const) {
    const broken = setup(async () => {
      throw Error(message);
    });
    const response = await broken.h.GET(new Request('http://127.0.0.1:3000/api/refunds'));
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes('SECRET'));
  }
});
