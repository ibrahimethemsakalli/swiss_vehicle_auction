import 'dotenv/config';
import { db } from '../src/lib/db';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/autoveri') throw new Error('Local database only');
  const holds = await db.paymentHold.findMany({ where: { gateway: 'local-test' }, select: { status: true, amount: true, currency: true, user: { select: { email: true } }, transactions: { select: { status: true, operation: true, attempts: true } } } });
  console.log(JSON.stringify(holds, null, 2));
  console.log(JSON.stringify(await db.settlement.findMany({ where: { bid: { hold: { gateway: 'local-test' } } }, select: { status: true, vehicle: { select: { status: true } } } })));
}
main().finally(() => db.$disconnect());
