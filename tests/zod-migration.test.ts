import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { registrationInput } from '../src/lib/registration';
import { vehicleInput } from '../src/lib/vehicles';
import { filterInput } from '../src/lib/market-query';
import { bidInput } from '../src/lib/bidding';
import { openDisputeInput, reviewDisputeInput } from '../src/lib/disputes';
import { acceptanceInput } from '../src/lib/legal-policy';
import { emailInput, passwordInput, pastDateInput } from '../src/lib/validation-inputs';
import { publicValidation } from '../src/lib/validation-errors';
import { readValidation, validationFields, validationKeys } from '../src/lib/validation-public';
import { apiError } from '../src/lib/http';
import { GET as market } from '../src/app/api/market/route';
import { POST as registerApi } from '../src/app/api/register/route';
import de from '../src/messages/de.json';
import fr from '../src/messages/fr.json';
import it from '../src/messages/it.json';
import en from '../src/messages/en.json';
import ValidationAudit from '../src/app/dev/validation-audit/page';

const registration = {
  email: '  Buyer+test@Example.test  ',
  password: 'Fixture-password-123!',
  phone: '+4236612345',
  role: 'PRIVATE_USER',
  language: 'en',
};
const vehicle = {
  make: 'FIXTURE',
  model: 'Validation only',
  stammnummer: '123456789',
  vinChassis: 'WBA12345678901234',
  firstRegistration: '2020-01-01',
  mileage: 1000,
  canton: 'ZH',
  mfkDate: '2025-01-01',
  serviceHistory: 'FULL',
  tireCondition: 'Test',
  description: 'Schema fixture only',
  images: [`/api/uploads/${randomUUID()}.jpg`],
  listingType: 'AUCTION_7_DAYS',
  startPrice: '1000.00',
};
const issues = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  assert.equal(result.success, false);
  return publicValidation(result.error);
};

test('Zod4 registration preserves normalization, CH/LI roles and dealer conditional field errors', () => {
  assert.equal(registrationInput.parse(registration).email, 'buyer+test@example.test');
  assert.ok(registrationInput.safeParse({ ...registration, phone: '+41791234567' }).success);
  assert.equal(registrationInput.safeParse({ ...registration, role: 'ADMIN' }).success, false);
  assert.equal(
    registrationInput.safeParse({ ...registration, phone: '+4230123456' }).success,
    false,
  );
  assert.deepEqual(
    issues(registrationInput, { ...registration, role: 'DEALER' })
      .map((v) => v.field)
      .sort(),
    ['companyName', 'handelsregisterNr'],
  );
  assert.ok(
    registrationInput.safeParse({
      ...registration,
      role: 'DEALER',
      companyName: 'Fixture',
      handelsregisterNr: 'LOCAL-FIXTURE',
    }).success,
  );
  assert.equal(
    registrationInput.safeParse({ ...registration, isIdentityVerified: true }).success,
    false,
  );
});
test('Zod4 shared password/email validation enforces UTF8 byte and format limits', () => {
  assert.ok(passwordInput.safeParse('x'.repeat(72)).success);
  assert.equal(passwordInput.safeParse('x'.repeat(73)).success, false);
  assert.ok(passwordInput.safeParse('😀'.repeat(18)).success);
  assert.equal(passwordInput.safeParse('😀'.repeat(19)).success, false);
  assert.equal(passwordInput.safeParse('short').success, false);
  assert.equal(emailInput.safeParse('user@@example.test').success, false);
  assert.equal(emailInput.safeParse('a'.repeat(255) + '@example.test').success, false);
  assert.ok(
    issues(z.object({ password: passwordInput }), { password: '😀'.repeat(19) }).some(
      (v) => v.field === 'password' && v.key === 'validationPasswordBytes',
    ),
  );
});
test('Zod4 dates reject epoch coercion, invalid leap dates and future values', () => {
  for (const value of [null, true, 0, '', '2023-02-29', '2024-02-31', '2100-01-01'])
    assert.equal(pastDateInput.safeParse(value).success, false, String(value));
  for (const value of ['2024-02-29', '2020-01-01T00:00:00Z', new Date('2020-01-01')])
    assert.ok(pastDateInput.safeParse(value).success);
  assert.ok(vehicleInput.safeParse(vehicle).success);
  assert.equal(vehicleInput.safeParse({ ...vehicle, mfkDate: null }).success, false);
});
test('Zod4 vehicle bounds, optional defaults, arrays and uniqueness remain constrained', () => {
  assert.deepEqual(vehicleInput.parse(vehicle).equipment, []);
  vehicleInput.parse(vehicle).equipment.push('NAVIGATION');
  assert.deepEqual(vehicleInput.parse(vehicle).equipment, []);
  for (const patch of [
    { mileage: NaN },
    { mileage: Infinity },
    { mileage: Number.MAX_SAFE_INTEGER + 1 },
    { mileage: 0.5 },
    { fuelType: 'UNKNOWN' },
    { images: [] },
    { images: Array(13).fill(vehicle.images[0]) },
    { images: [vehicle.images[0], vehicle.images[0]] },
    { equipment: Array(4096).fill('INVALID') },
  ])
    assert.equal(vehicleInput.safeParse({ ...vehicle, ...patch }).success, false);
  assert.equal(vehicleInput.safeParse({ ...vehicle, extra: 'not-allowed' }).success, false);
  assert.ok(
    issues(vehicleInput, { ...vehicle, images: [vehicle.images[0], vehicle.images[0]] }).some(
      (v) => v.key === 'validationUnique',
    ),
  );
});
test('Zod4 filter records preserve partial dictionaries/defaults and reject invalid keys/ranges', () => {
  assert.ok(
    filterInput.safeParse({
      specs: { fuelType: 'PETROL' },
      ranges: { powerKw: { min: 50, max: 200 } },
    }).success,
  );
  assert.equal(filterInput.parse({}).privateOnly, true);
  assert.equal(filterInput.parse({}).query, '');
  for (const value of [
    { specs: { notAField: 'X' } },
    { specs: { fuelType: 3 } },
    { ranges: { notAField: { min: 1 } } },
    { ranges: { powerKw: { min: NaN } } },
    { ranges: { powerKw: { max: Infinity } } },
    { equipment: Array(4096).fill('X') },
    { privateOnly: 'false' },
    { extra: 1 },
  ])
    assert.equal(filterInput.safeParse(value).success, false);
});
test('Zod4 UUID, money, consent and dispute input shapes reject forged or oversized fields without actions', () => {
  const id = randomUUID(),
    bid = { vehicleId: id, holdId: id, requestId: id, amount: '123.45' };
  assert.ok(bidInput.safeParse(bid).success);
  for (const patch of [
    { amount: '1e4' },
    { amount: '12.345' },
    { amount: '-30' },
    { vehicleId: '11111111-1111-4111-1111-111111111111' },
    { requestId: 'bad' },
  ])
    assert.equal(bidInput.safeParse({ ...bid, ...patch }).success, false);
  const consent = {
    releaseId: id,
    locale: 'en',
    termsAccepted: true,
    privacyAcknowledged: true,
    eligibilityDeclared: true,
  };
  assert.ok(acceptanceInput.safeParse(consent).success);
  assert.equal(acceptanceInput.safeParse({ ...consent, termsAccepted: false }).success, false);
  assert.ok(
    openDisputeInput.safeParse({
      settlementId: id,
      category: 'OTHER',
      message: 'Validation fixture message only',
    }).success,
  );
  assert.equal(
    openDisputeInput.safeParse({ settlementId: id, category: 'OTHER', message: 'short' }).success,
    false,
  );
  assert.equal(
    reviewDisputeInput.safeParse({
      id,
      resolution: 'UNSUPPORTED',
      note: 'Validation fixture message only',
    }).success,
    false,
  );
});
test('public Zod4 errors are capped, whitelist localized keys and never return inputs or unknown paths', async () => {
  const value = {
    email: 'SECRET-INVALID-EMAIL',
    password: 'SECRET-PASSWORD',
    privateSensitiveKey: 'SECRET-VALUE',
  };
  const result = z
    .object({ email: z.email(), password: z.string().min(30) })
    .strict()
    .safeParse(value);
  assert.equal(result.success, false);
  const response = apiError(result.error);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'REQUEST_REJECTED');
  assert.ok(body.validation.length);
  assert.equal(JSON.stringify(body).includes('SECRET'), false);
  assert.equal(JSON.stringify(body).includes('privateSensitiveKey'), false);
  const many = z.array(z.string()).safeParse(Array(4096).fill(0));
  assert.equal(many.success, false);
  assert.ok(publicValidation(many.error).length <= 10);
  assert.deepEqual(
    readValidation({
      validation: [
        { field: 'password', key: 'DO_NOT_RENDER_RAW_MESSAGE' },
        { field: '__proto__', key: 'validationInvalid' },
      ],
    }),
    [],
  );
  assert.deepEqual(
    readValidation({
      validation: [
        { field: 'images', key: 'validationMaxItems', values: { count: Infinity } },
        { field: 'password', key: 'validationMaxLength' },
      ],
    }),
    [],
  );
  for (const catalog of [de, fr, it, en])
    for (const issue of body.validation) {
      assert.ok(catalog[validationFields[issue.field as keyof typeof validationFields]]);
      assert.ok(catalog[issue.key as keyof typeof catalog]);
    }
});
test('validation display fixture is unavailable in production', () => {
  const old = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  try {
    assert.throws(() => ValidationAudit(), /NEXT_HTTP_ERROR_FALLBACK;404/);
  } finally {
    if (old === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else Object.assign(process.env, { NODE_ENV: old });
  }
});
test('four-language new validation messages resolve every interpolation consistently', () => {
  for (const catalog of [de, fr, it, en]) {
    for (const key of validationKeys) assert.ok(catalog[key]);
    assert.ok(catalog.validationSummary);
    assert.ok(catalog.validationForm);
    for (const key of validationKeys)
      assert.deepEqual(catalog[key].match(/\{\{\w+\}\}/g), en[key].match(/\{\{\w+\}\}/g));
  }
});
test('exclusive numeric bounds describe strict inequalities rather than allowing their endpoints', () => {
  assert.deepEqual(issues(z.object({ amount: z.number().positive() }), { amount: 0 }), [
    { field: 'amount', key: 'validationMoreThan', values: { value: 0 } },
  ]);
  assert.deepEqual(issues(z.object({ amount: z.number().lt(10) }), { amount: 10 }), [
    { field: 'amount', key: 'validationLessThan', values: { value: 10 } },
  ]);
});
test('invalid registration and filter HTTP inputs fail before DB/provider access with stable error codes', async () => {
  const old = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = 'http://127.0.0.1:3191';
  try {
    const rejected = await registerApi(
      new Request('http://127.0.0.1:3191/api/register', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3191', 'content-type': 'application/json' },
        body: JSON.stringify({ ...registration, password: 'short', phone: 'bad' }),
      }),
    );
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, 'REQUEST_REJECTED');
    const filters = await market(
      new Request(
        'http://127.0.0.1:3191/api/market?filters=' +
          encodeURIComponent(JSON.stringify({ privateOnly: 'wrong' })),
      ),
    );
    assert.equal(filters.status, 400);
    assert.equal((await filters.json()).error, 'INVALID_FILTERS');
  } finally {
    if (old === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = old;
  }
});
