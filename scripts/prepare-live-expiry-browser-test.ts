import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/autoveri'
  )
    throw new Error('Local development only');
  const seller = await db.user.findUniqueOrThrow({
    where: { email: 'private_user@local.autoveri.test' },
  });
  if (seller.phone !== 'LOCAL-LOGIN-0' || !seller.isIdentityVerified || !seller.phoneVerifiedAt)
    throw new Error('Verified local fixture required');
  const source = await db.vehicle.findUniqueOrThrow({
    where: { id: '4fc063f7-2a14-4ee6-b533-fd503f504ce5' },
  });
  if (source.userId !== seller.id || !source.description.startsWith('LOCAL E2E TEST'))
    throw new Error('Fixture mismatch');
  const id = randomUUID();
  const vehicle = await db.vehicle.create({
    data: {
      id,
      userId: seller.id,
      make: 'Volkswagen',
      model: 'Golf — LOCAL LIVE EXPIRY TEST',
      stammnummer: '999261020',
      vinChassis: `TEST${id.replaceAll('-', '').slice(0, 13).toUpperCase()}`,
      firstRegistration: source.firstRegistration,
      mileage: 42500,
      canton: 'ZH',
      mfkDate: source.mfkDate,
      serviceHistory: 'FULL',
      tireCondition: 'Local test fixture',
      description:
        'LOCAL E2E TEST — automatic expiry of a saved listing. Fictional listing; no real sale or payment.',
      images: source.images,
      listingType: 'AUCTION_7_DAYS',
      status: 'ACTIVE',
      isVerifiedPrivate: true,
      startPrice: '1000',
      auctionStartAt: new Date(),
      auctionEndsAt: new Date(Date.now() + 120000),
    },
  });
  console.log(
    `Prepared local fixture only; bids and settlement actions will be performed in browser: http://localhost:3000/vehicles/${vehicle.id}`,
  );
}
main().finally(() => db.$disconnect());



