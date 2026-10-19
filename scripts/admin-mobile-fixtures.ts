import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { db } from '../src/lib/db';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/autoveri'
  )
    throw Error('Local fixtures only');
  const path = '.local/admin-mobile-fixtures.json';
  if (process.argv.includes('--cleanup')) {
    const ids = JSON.parse(await readFile(path, 'utf8'));
    await db.dispute.deleteMany({
      where: { id: ids.dispute, message: { startsWith: 'LOCAL MOBILE UI ONLY' } },
    });
    await db.vehicle.deleteMany({
      where: {
        id: ids.vehicle,
        description: 'LOCAL MOBILE UI ONLY',
        status: 'PENDING_VERIFICATION',
      },
    });
    console.log('UI fixtures removed.');
    return;
  }
  const user = await db.user.findUniqueOrThrow({
    where: { email: 'private_user@local.autoveri.test' },
  });
  const sale = await db.settlement.findFirstOrThrow({
    where: { status: 'CANCELLED', vehicle: { userId: user.id } },
    include: { bid: true },
  });
  const ids = { vehicle: randomUUID(), dispute: randomUUID() };
  await writeFile(path, JSON.stringify(ids));
  await db.$transaction(async (tx) => {
    await tx.vehicle.create({
      data: {
        id: ids.vehicle,
        userId: user.id,
        isSample: true,
        make: 'LOCAL MOBILE UI',
        model: 'Langer Modellname zur Prüfung der mobilen Inseratfreigabe',
        vinChassis: `MOB${Date.now()}`,
        stammnummer: '000000000',
        firstRegistration: new Date('2020-01-01'),
        mileage: 1000,
        canton: 'ZH',
        mfkDate: new Date('2025-01-01'),
        serviceHistory: 'NONE',
        tireCondition: 'UI fixture',
        description: 'LOCAL MOBILE UI ONLY',
        images: ['/samples/photos/car-1-1.jpg'],
        listingType: 'AUCTION_7_DAYS',
        startPrice: 1000,
        status: 'PENDING_VERIFICATION',
      },
    });
    await tx.dispute.create({
      data: {
        id: ids.dispute,
        settlementId: sale.id,
        reporterId: sale.bid.userId,
        category: 'OTHER',
        message: 'LOCAL MOBILE UI ONLY — ' + 'LangerPruefungshinweisOhneLeerzeichen'.repeat(15),
        status: 'OPEN',
      },
    });
  });
  console.log(
    'Created temporary pending-listing and dispute UI fixtures on an already cancelled sale. No financial operations.',
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
