import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createDatabaseClient } from '../src/lib/database-client.ts';
import { ciEnvironment } from './ci-environment.mjs';
const source = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
const name = `autoveri_pm21_${randomUUID().replaceAll('-', '')}_test`,
  target = new URL(source),
  maintenance = new URL(source);
target.pathname = '/' + name;
maintenance.pathname = '/postgres';
Object.assign(process.env, ciEnvironment(process.env, target.toString()));
const control = createDatabaseClient(maintenance.toString()),
  db = createDatabaseClient(target.toString());
let created = false;
try {
  await control.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(migration.status, 0, migration.stderr);
  const { marketSearchSql, searchMarket } = await import('../src/lib/market-search.ts');
  const { filterInput, marketWhere } = await import('../src/lib/market-query.ts');
  const { GET } = await import('../src/app/api/market/route.ts');
  const { Prisma } = await import('../src/generated/prisma/client.ts');
  const privateOwner = await db.user.create({
    data: { email: 'private@pm21.test', phone: 'pm21-private', passwordHash: 'not-a-login' },
  });
  const dealer = await db.user.create({
    data: {
      email: 'dealer@pm21.test',
      phone: 'pm21-dealer',
      passwordHash: 'not-a-login',
      role: 'DEALER',
    },
  });
  const now = new Date();
  const row = (i) => ({
    id: randomUUID(),
    userId: i % 3 ? privateOwner.id : dealer.id,
    vinChassis: `pm21-${i}`,
    stammnummer: `pm21-${i}`,
    make: i % 2 ? 'BMW' : 'Audi',
    model: i % 2 ? '320 Touring' : 'A4 Avant',
    mileage: i * 100,
    canton: i % 3 ? 'BE' : 'ZH',
    city: i % 3 ? 'Bern' : 'Zürich',
    postalCode: i % 3 ? '3000' : '8000',
    modelYear: i % 4 ? 2010 + (i % 15) : null,
    firstRegistration: new Date('2020-01-01'),
    fuelType: i % 2 ? 'DIESEL' : 'ELECTRIC',
    transmission: 'AUTOMATIC',
    bodyType: 'ESTATE',
    drivetrain: 'AWD',
    condition: 'USED',
    exteriorColor: 'BLACK',
    interiorColor: 'BLACK',
    energyClass: 'ENERGY_A',
    euroNorm: 'EURO_6',
    accidentHistory: 'ACCIDENT_FREE',
    warranty: 'NO',
    fuelConsumption: i % 3 ? 5.5 : null,
    electricConsumption: 18,
    co2Emissions: 120,
    rangeKm: 400,
    batteryHealth: 91.2,
    batteryCapacity: 65,
    seats: 5,
    doors: 5,
    powerKw: 150,
    cubicCapacity: 1998,
    equipment: i % 2 ? ['CARPLAY', 'HEATED_SEATS'] : [],
    mfkStatus: i % 3 ? 'DATED' : 'UNKNOWN',
    mfkDate: i % 3 ? new Date(now.getTime() - 86400000 * (i % 2 ? 30 : 500)) : null,
    isSample: i % 11 === 0,
    serviceHistory: 'NONE',
    tireCondition: 'unknown',
    description: 'Isolated synthetic search fixture',
    images: [],
    listingType: i % 4 === 0 ? 'FIXED_PRICE_OFFERS' : 'AUCTION_7_DAYS',
    startPrice: 1000 + (i % 8) * 100 + 0.25,
    currentPrice: i % 3 ? 2000 + (i % 8) * 100 + 0.75 : null,
    buyNowPrice: i % 8 === 0 ? 3000 : null,
    status: i % 13 === 0 ? 'SOLD' : 'ACTIVE',
    auctionEndsAt: i % 4 === 0 ? null : new Date(now.getTime() + (i % 10) * 3600000),
  });
  await db.vehicle.createMany({ data: Array.from({ length: 180 }, (_, i) => row(i)) });
  const variants = [
    {},
    { privateOnly: false },
    { make: 'BMW' },
    { model: 'A4 Avant' },
    { query: 'Audi Avant', privateOnly: false },
    { city: ' bern ' },
    { city: 'ZÜRICH', privateOnly: false },
    { city: '%', privateOnly: false },
    { postalCode: '80', privateOnly: false },
    { canton: 'ZH', privateOnly: false },
    { minPrice: 1300, price: 2200.75 },
    { minMileage: 500.5, mileage: 7000.9 },
    { minMileage: 2147483648 },
    { yearFrom: 2015, yearTo: 2022 },
    { mfk: true },
    { equipment: ['CARPLAY', 'HEATED_SEATS'] },
    { query: "x'; DROP TABLE Vehicle; --" },
    { query: '%' },
    { query: '_' },
    { make: 'missing' },
  ];
  const { specOptions, specNumbers } = await import('../src/lib/vehicle-specs.ts');
  for (const [key, values] of Object.entries(specOptions))
    variants.push({ specs: { [key]: values[0] }, privateOnly: false });
  for (const key of [...Object.keys(specNumbers), 'powerKw', 'cubicCapacity'])
    variants.push({ ranges: { [key]: { min: 0.1, max: 2000.9 } }, privateOnly: false });
  variants.push({ ranges: { seats: { min: 2147483648 } } });
  let comparisons = 0;
  for (const variant of process.argv.includes('--performance-only') ? [] : variants)
    for (const sort of ['ending', 'priceAsc', 'priceDesc']) {
      const filters = filterInput.parse({ ...variant, sort });
      const expected = await db.vehicle.findMany({
        where: marketWhere(filters, now),
        select: {
          id: true,
          listingType: true,
          startPrice: true,
          currentPrice: true,
          buyNowPrice: true,
          auctionEndsAt: true,
        },
      });
      const price = (v) =>
        Number(
          v.listingType === 'FIXED_PRICE_OFFERS'
            ? (v.buyNowPrice ?? v.startPrice)
            : (v.currentPrice ?? v.startPrice),
        );
      expected.sort(
        (a, b) =>
          (sort === 'priceAsc'
            ? price(a) - price(b)
            : sort === 'priceDesc'
              ? price(b) - price(a)
              : (a.auctionEndsAt?.getTime() ?? Infinity) -
                (b.auctionEndsAt?.getTime() ?? Infinity)) || a.id.localeCompare(b.id),
      );
      for (const page of [1, 2, 9]) {
        const sql = marketSearchSql(filters, page, now),
          actual = await db.$queryRaw(sql.ids),
          [count] = await db.$queryRaw(sql.count);
        assert.deepEqual(
          actual.map((v) => v.id),
          expected.slice((page - 1) * 24, page * 24).map((v) => v.id),
          JSON.stringify({ variant, sort, page }),
        );
        assert.equal(Number(count.total), expected.length);
        comparisons++;
      }
    }
  if (!process.argv.includes('--performance-only')) {
    const api = await GET(
      new Request(
        'http://localhost/api/market?filters=' +
          encodeURIComponent(JSON.stringify({ privateOnly: false, sort: 'priceDesc' })),
      ),
    );
    assert.equal(api.status, 200);
    assert.equal(api.headers.get('cache-control'), 'no-store');
    const response = await api.json();
    assert.equal(response.vehicles.length, 24);
    assert.ok(response.catalog.length > 0);
    assert.equal((await GET(new Request('http://localhost/api/market?filters=bad'))).status, 400);
    assert.equal((await GET(new Request('http://localhost/api/market?page=1.5'))).status, 400);
    // Force another connection to close one listing after IDs have been read.
    let changed = false;
    const snapshotClient = {
      $transaction: (fn, options) =>
        db.$transaction(
          (tx) =>
            fn(
              new Proxy(tx, {
                get(t, key) {
                  if (key === '$queryRaw')
                    return async (sql) => {
                      const result = await t.$queryRaw(sql);
                      if (!changed) {
                        changed = true;
                        await db.vehicle.update({
                          where: { id: result[0].id },
                          data: { status: 'SOLD' },
                        });
                      }
                      return result;
                    };
                  return Reflect.get(t, key);
                },
              }),
            ),
          options,
        ),
    };
    const before = await db.vehicle.count({ where: marketWhere(filterInput.parse({})) });
    const snapshot = await searchMarket({}, 1, snapshotClient);
    assert.equal(snapshot.total, before);
    assert.equal(snapshot.vehicles.length, 24);
    assert.ok(snapshot.vehicles.every((v) => v.status === 'ACTIVE'));
    assert.equal((await searchMarket({}, 1, db)).total, before - 1);
  }
  // Realistic local volume: 20,000 synthetic rows, mixed sellers, prices, end dates and status.
  for (let start = 180; start < 20000; start += 1000)
    await db.vehicle.createMany({
      data: Array.from({ length: Math.min(1000, 20000 - start) }, (_, i) => row(start + i)),
    });
  await db.$executeRaw`ANALYZE "Vehicle"`;
  await db.$executeRaw`ANALYZE "User"`;
  const measurements = [];
  for (const [label, filters, page] of [
    ['ending', {}, 1],
    ['price', { sort: 'priceAsc' }, 1],
    ['filtered', { city: 'Bern', make: 'BMW', sort: 'priceDesc' }, 1],
    ['deep-page', { privateOnly: false, sort: 'priceAsc' }, 500],
  ]) {
    const sql = marketSearchSql(filters, page);
    const plan = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql.ids}`);
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      const result = await searchMarket(filters, page, db);
      samples.push(performance.now() - t);
      assert.ok(result.vehicles.length <= 24);
    }
    samples.sort((a, b) => a - b);
    measurements.push({
      label,
      page,
      medianMs: +samples[2].toFixed(2),
      maxMs: +samples[4].toFixed(2),
      plan: plan[0]['QUERY PLAN'],
    });
  }
  const filters = filterInput.parse({ sort: 'priceAsc' });
  const t = performance.now();
  const oldRows = await db.vehicle.findMany({
    where: marketWhere(filters),
    select: {
      id: true,
      listingType: true,
      startPrice: true,
      currentPrice: true,
      buyNowPrice: true,
      auctionEndsAt: true,
    },
  });
  const oldTransferMs = performance.now() - t;
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/pm21-search-performance.json',
    JSON.stringify(
      {
        rows: 20000,
        comparisons,
        oldRowsTransferred: oldRows.length,
        oldTransferMs,
        newPageIdsTransferred: 24,
        measurements,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      comparisons,
      oldRowsTransferred: oldRows.length,
      oldTransferMs: +oldTransferMs.toFixed(2),
      measurements: measurements.map(({ plan, ...rest }) => rest),
    }),
  );
  const diff = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  assert.equal(diff.status, 0, diff.stdout + diff.stderr);
  console.log(
    process.argv.includes('--performance-only')
      ? 'PASS: targeted 20k-row query plans and schema alignment; earlier functional checks not repeated.'
      : 'PASS: filter/sort equivalence, pages, HTTP contract, concurrent snapshot, 20k-row query plans and schema alignment. No external APIs.',
  );
} finally {
  await db.$disconnect();
  if (created) {
    assert.match(name, /^autoveri_pm21_[a-f0-9]{32}_test$/);
    await control.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await control.$disconnect();
  console.log('PM21 isolated database removed.');
}
