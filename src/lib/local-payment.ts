import { db } from './db';
import type { Intent, PaymentGateway } from './payments';

const localHosts = ['localhost', '127.0.0.1', '[::1]'];
export function localPaymentsEnabled() {
  try {
    const database = new URL(process.env.DATABASE_URL ?? '');
    const origin = new URL(process.env.NEXTAUTH_URL ?? '');
    return (
      process.env.LOCAL_TEST_PAYMENTS === 'true' &&
      process.env.NODE_ENV === 'development' &&
      localHosts.includes(database.hostname) &&
      database.pathname === '/autoveri' &&
      localHosts.includes(origin.hostname) &&
      origin.protocol === 'http:' &&
      localHosts.includes(process.env.HOST ?? '127.0.0.1') &&
      !process.env.STRIPE_SECRET_KEY
    );
  } catch {
    return false;
  }
}
export function assertLocalRequest(request: Request) {
  if (!localPaymentsEnabled() || !localHosts.includes(new URL(request.url).hostname))
    throw new Error('FORBIDDEN');
}
export async function assertLocalAccount(id: string) {
  if (!localPaymentsEnabled()) throw new Error('FORBIDDEN');
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  const names = ['private_user', 'dealer', 'admin'];
  const index = names.indexOf(user.email.split('@')[0]);
  if (
    index < 0 ||
    user.email !== `${names[index]}@local.autoveri.test` ||
    user.phone !== `LOCAL-LOGIN-${index}` ||
    user.suspendedAt ||
    user.isSample
  )
    throw new Error('FORBIDDEN');
  return user;
}
export async function assertLocalVehicle(id: string) {
  const vehicle = await db.vehicle.findUniqueOrThrow({ where: { id } });
  await assertLocalAccount(vehicle.userId);
  if (vehicle.isSample || !vehicle.description.startsWith('LOCAL E2E TEST'))
    throw new Error('FORBIDDEN');
  if (await db.paymentHold.count({ where: { vehicleId: id, gateway: { not: 'local-test' } } }))
    throw new Error('FORBIDDEN');
  return vehicle;
}
type Stored = Omit<Intent, 'expiresAt'> & { expiresAt: string };
async function load(id: string): Promise<Intent> {
  if (!localPaymentsEnabled() || !id.startsWith('local_')) throw new Error('FORBIDDEN');
  const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
  if (row.kind !== 'local.payment.fixture') throw new Error('FORBIDDEN');
  const value = row.payload as unknown as Stored;
  await assertLocalAccount(value.userId);
  await assertLocalVehicle(value.vehicleId);
  return { ...value, expiresAt: new Date(value.expiresAt) };
}
async function change(id: string, state: 'released' | 'captured', captureKey?: string) {
  await load(id);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OutboxEvent" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.outboxEvent.findUniqueOrThrow({ where: { id } });
    const value = row.payload as unknown as Stored;
    if (value.state === state && (state !== 'captured' || value.captureKey === captureKey))
      return { ...value, expiresAt: new Date(value.expiresAt) };
    if (
      value.state !== 'authorized' ||
      (state === 'captured' && new Date(value.expiresAt) <= new Date())
    )
      throw new Error('INVALID_HOLD');
    const updated = { ...value, state, ...(captureKey ? { captureKey } : {}) };
    await tx.outboxEvent.update({ where: { id }, data: { payload: updated } });
    return { ...updated, expiresAt: new Date(updated.expiresAt) };
  });
}
export const localGateway: PaymentGateway = {
  async create(hold) {
    await assertLocalAccount(hold.userId);
    await assertLocalVehicle(hold.vehicleId);
    const id = `local_${hold.id}`;
    const payload: Stored = {
      ...hold,
      id,
      holdId: hold.id,
      clientSecret: null,
      state: 'authorized',
      valid: true,
      expiresAt: new Date(Date.now() + 8 * 86400000).toISOString(),
    };
    await db.outboxEvent.upsert({
      where: { id },
      create: { id, kind: 'local.payment.fixture', payload, deliveredAt: new Date() },
      update: {},
    });
    return load(id);
  },
  retrieve: load,
  release: (id) => change(id, 'released'),
  capture: (id, key) => change(id, 'captured', key),
};
