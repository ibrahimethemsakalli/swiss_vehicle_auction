import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { db } from '../src/lib/db';
import { samplePhotoPaths } from '../src/lib/sample-photos';
import { sampleFacts } from '../src/lib/sample-facts';

// Prices, mileage and cantons are explicitly fictional test data.
const cars = [
  [42500, 'ZH', 21900],
  [68500, 'BE', 24700],
  [56200, 'LU', 29800],
  [39000, 'SG', 38900],
  [72000, 'AG', 23900],
  [18200, 'VD', 20900],
  [61000, 'GE', 32900],
  [26800, 'FR', 15900],
  [48000, 'ZG', 46900],
  [45000, 'BS', 28900],
  [33700, 'TI', 12900],
  [79000, 'GR', 26900],
] as const;
async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Sample seed is for local development only');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('Sample seed requires a local database');
  const passwordHash = await hash(randomBytes(48).toString('hex'), 12);
  for (const dealer of [false, true]) {
    const id = dealer
      ? '92000000-0000-4000-8000-000000000002'
      : '92000000-0000-4000-8000-000000000001';
    const existing = await db.user.findUnique({ where: { id } });
    if (existing && !existing.isSample) throw new Error('Seed ID collision');
    await db.user.upsert({
      where: { id },
      create: {
        id,
        email: dealer ? 'dealer@sample.example.test' : 'private@sample.example.test',
        phone: dealer ? 'sample-dealer-no-phone' : 'sample-private-no-phone',
        passwordHash,
        isSample: true,
        role: dealer ? 'DEALER' : 'PRIVATE_USER',
      },
      update: {},
    });
  }
  for (const [i, car] of cars.entries()) {
    const [mileage, canton, price] = car;
    const id = `91000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const old = await db.vehicle.findUnique({
      where: { id },
      include: { _count: { select: { bids: true } } },
    });
    if (old && (!old.isSample || old._count.bids))
      throw new Error('Refusing to overwrite non-sample or bid-bearing listing');
    const fixed = i % 4 === 3;
    const dealer = i % 4 === 2;
    const now = new Date();
    const data = {
      userId: dealer
        ? '92000000-0000-4000-8000-000000000002'
        : '92000000-0000-4000-8000-000000000001',
      isSample: true,
      stammnummer: String(900000001 + i),
      vinChassis: `SAMPLE${String(i + 1).padStart(11, '0')}`,
      mileage,
      canton,
      mfkDate: new Date(Date.now() - (i % 3 === 0 ? 420 : 65 + i * 10) * 86400000),
      serviceHistory: i % 3 === 0 ? 'PARTIAL' : 'FULL',
      tireCondition: 'Beispieldaten / Données fictives / Dati di esempio / Sample data',
      images: samplePhotoPaths(i + 1),
      ...sampleFacts(i + 1),
      listingType: fixed ? ('FIXED_PRICE_OFFERS' as const) : ('AUCTION_7_DAYS' as const),
      status: 'ACTIVE' as const,
      isVerifiedPrivate: false,
      startPrice: String(price),
      buyNowPrice: fixed ? String(price) : null,
      reservePrice: null,
      currentPrice: null,
      auctionStartAt: fixed ? null : now,
      auctionEndsAt: fixed ? null : new Date(Date.now() + (2 + (i % 6)) * 86400000),
    };
    await db.vehicle.upsert({ where: { id }, create: { id, ...data }, update: data });
  }
  console.log(
    '12 clearly labeled sample vehicles created/updated with licensed photographs. Sample accounts cannot sign in; sample listings cannot take payments or bids.',
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
