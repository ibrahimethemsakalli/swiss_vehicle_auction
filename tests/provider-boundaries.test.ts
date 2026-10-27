import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { paymentRoute, assertRealSmsId } from '../src/lib/provider-isolation';
import { twilioTransport } from '../src/lib/twilio-transport';
import { normalizeStripeIntent, stripeGateway, stripeClient } from '../src/lib/payments';

const sid = `VE${'a'.repeat(32)}`,
  phone = '+4236612345';
const config = { account: 'fixture-account', token: 'fixture-secret', service: 'fixture-service' };
const response = (body: unknown, status = 200) => Response.json(body, { status });
const gateway = (body: unknown, status = 200) =>
  twilioTransport(config, (async () => response(body, status)) as typeof fetch);

test('payment provider isolation rejects invalid simulation and mixed provider identifiers', () => {
  assert.throws(() => paymentRoute({ requested: true, enabled: false }), /PROVIDER_UNAVAILABLE/);
  const local = { requested: true, enabled: true },
    real = { requested: false, enabled: false };
  assert.equal(paymentRoute(local), 'local');
  assert.equal(paymentRoute(real), 'stripe');
  for (const id of ['pi_real', ''])
    if (id) assert.throws(() => paymentRoute(local, id), /FORBIDDEN/);
  assert.throws(() => paymentRoute(real, 'local_fixture'), /FORBIDDEN/);
  assert.throws(() => paymentRoute(local, undefined, 'stripe'), /FORBIDDEN/);
  assert.throws(() => paymentRoute(real, undefined, 'local-test'), /FORBIDDEN/);
});

test('misconfigured local mode cannot construct Stripe client or call any real gateway operation', async () => {
  const old = { flag: process.env.LOCAL_TEST_PAYMENTS, key: process.env.STRIPE_SECRET_KEY };
  process.env.LOCAL_TEST_PAYMENTS = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_OFFLINE_FIXTURE';
  try {
    assert.throws(stripeClient, /PROVIDER_UNAVAILABLE/);
    for (const run of [
      () => stripeGateway.create({ id: 'fixture', userId: 'u', vehicleId: 'v' }),
      () => stripeGateway.retrieve('pi_fixture'),
      () => stripeGateway.release('pi_fixture', 'key'),
      () => stripeGateway.capture('pi_fixture', 'key'),
    ]) {
      await assert.rejects(async () => run(), /PROVIDER_UNAVAILABLE/);
    }
  } finally {
    for (const [key, value] of [
      ['LOCAL_TEST_PAYMENTS', old.flag],
      ['STRIPE_SECRET_KEY', old.key],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});

function intent(overrides: object = {}) {
  return {
    id: 'pi_fixture',
    client_secret: null,
    amount: 3000,
    currency: 'chf',
    capture_method: 'manual',
    livemode: false,
    status: 'requires_capture',
    amount_capturable: 3000,
    amount_received: 0,
    metadata: { holdId: 'hold', userId: 'buyer', vehicleId: 'car' },
    latest_charge: { payment_method_details: { card: { capture_before: 2000000000 } } },
    ...overrides,
  } as unknown as Stripe.PaymentIntent;
}
test('Stripe fixture normalization preserves exact CHF30 amount and provider capture deadline', () => {
  const value = normalizeStripeIntent(intent());
  assert.equal(value.valid, true);
  assert.equal(value.state, 'authorized');
  assert.equal(value.expiresAt!.getTime(), 2000000000000);
  for (const patch of [
    { amount: 2999 },
    { currency: 'eur' },
    { capture_method: 'automatic' },
    { amount_capturable: 2999 },
  ])
    assert.equal(normalizeStripeIntent(intent(patch)).valid, false);
  assert.equal(normalizeStripeIntent(intent({ latest_charge: null })).expiresAt, undefined);
});
test('Stripe failed authorization is distinguishable from customer action still pending', () => {
  assert.equal(
    normalizeStripeIntent(
      intent({ status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } }),
    ).state,
    'failed',
  );
  assert.equal(normalizeStripeIntent(intent({ status: 'requires_action' })).state, 'pending');
  assert.equal(normalizeStripeIntent(intent({ status: 'processing' })).state, 'pending');
});

test('SMS +423 and all four locales use bounded POST requests with correctly bound responses', async () => {
  for (const locale of ['de', 'fr', 'it', 'en']) {
    const transport = twilioTransport(config, (async (url, options) => {
      assert.match(String(url), /^https:\/\/verify\.twilio\.com\//);
      assert.equal(options!.method, 'POST');
      assert.equal(options!.cache, 'no-store');
      assert.ok(options!.signal);
      const form = options!.body as URLSearchParams;
      assert.equal(form.get('To'), phone);
      assert.equal(form.get('Locale'), locale);
      assert.equal(form.get('Channel'), 'sms');
      return response({ sid, status: 'pending', to: phone, channel: 'sms' });
    }) as typeof fetch);
    assert.equal(await transport.send(phone, locale), sid);
  }
});
test('SMS malformed/local IDs and invalid codes are rejected before any network request', async () => {
  let calls = 0;
  const transport = twilioTransport(config, (async () => {
    calls++;
    throw Error('Unexpected network');
  }) as typeof fetch);
  for (const id of ['local_sms', 'a'.repeat(32), 'VEbad']) {
    assert.throws(() => assertRealSmsId(id));
    await assert.rejects(transport.check(id, '123456'));
  }
  await assert.rejects(transport.check(sid, 'letters'));
  assert.equal(calls, 0);
});
test('SMS accepts only approved matching verification; send responses must match recipient/channel', async () => {
  assert.equal(await gateway({ sid, status: 'approved' }).check(sid, '123456'), true);
  for (const body of [
    { sid, status: 'pending' },
    { sid: `VE${'b'.repeat(32)}`, status: 'approved' },
    null,
  ])
    assert.equal(await gateway(body).check(sid, '123456'), false);
  for (const body of [
    { sid, status: 'pending', to: '+41791234567', channel: 'sms' },
    { sid, status: 'approved', to: phone, channel: 'sms' },
    { sid, status: 'pending', to: phone, channel: 'call' },
    null,
  ])
    await assert.rejects(gateway(body).send(phone, 'en'), /VERIFICATION_FAILED/);
});
test('SMS provider refusal, throttling, outage, timeout and malformed JSON never imply success', async () => {
  for (const status of [400, 401, 404])
    await assert.rejects(gateway({}, status).check(sid, '123456'), /VERIFICATION_FAILED/);
  for (const status of [429, 500, 503])
    await assert.rejects(gateway({}, status).check(sid, '123456'), /PROVIDER_UNAVAILABLE/);
  await assert.rejects(
    twilioTransport(config, (async () => {
      throw new DOMException('Timeout', 'TimeoutError');
    }) as typeof fetch).check(sid, '123456'),
    /PROVIDER_UNAVAILABLE/,
  );
  await assert.rejects(
    twilioTransport(config, (async () => new Response('not json')) as typeof fetch).check(
      sid,
      '123456',
    ),
    /PROVIDER_UNAVAILABLE/,
  );
  let calls = 0;
  await assert.rejects(
    twilioTransport({}, (async () => {
      calls++;
      return response({});
    }) as typeof fetch).send(phone, 'en'),
    /PROVIDER_UNAVAILABLE/,
  );
  assert.equal(calls, 0);
});

test('webhook boundary rejects local mode and invalid signature, accepts a signed ignored event offline', async () => {
  const { POST } = await import('../src/app/api/payments/webhook/route');
  const keys = ['LOCAL_TEST_PAYMENTS', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const original = keys.map((key) => process.env[key]);
  const secret = 'whsec_OFFLINE_FIXTURE';
  try {
    process.env.LOCAL_TEST_PAYMENTS = 'true';
    assert.equal(
      (
        await POST(
          new Request('http://127.0.0.1/api/payments/webhook', { method: 'POST', body: 'invalid' }),
        )
      ).status,
      503,
    );
    process.env.LOCAL_TEST_PAYMENTS = 'false';
    process.env.STRIPE_SECRET_KEY = 'sk_test_OFFLINE_FIXTURE';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const payload = JSON.stringify({
      id: 'evt_offline_ignored',
      type: 'fixture.ignored',
      data: { object: {} },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const request = (body: string, signature: string) =>
      new Request('http://127.0.0.1/api/payments/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': signature },
        body,
      });
    assert.equal((await POST(request(payload, 'bad-signature'))).status, 400);
    assert.equal((await POST(request(payload + ' ', header))).status, 400);
    assert.equal((await POST(request(payload, header))).status, 200);
  } finally {
    keys.forEach((key, i) => {
      if (original[i] === undefined) delete process.env[key];
      else process.env[key] = original[i];
    });
  }
});
