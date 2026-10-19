import 'dotenv/config';
if (process.env.NODE_ENV === 'production')
  throw new Error('Local test server cannot run in production');
process.env.NODE_ENV = 'development';
process.env.LOCAL_TEST_PAYMENTS = 'true';
process.env.HOST = '127.0.0.1';
const { localPaymentsEnabled } = await import('../src/lib/local-payment.ts');
if (!localPaymentsEnabled())
  throw new Error(
    'Local database/origin required; remove real Stripe keys before enabling local payment tests',
  );
console.log('LOCAL PAYMENT TEST MODE: no real money. Local fixture accounts only.');
await import('../server.ts');
