import 'dotenv/config';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import { marketWhere, filterInput } from '../src/lib/market-query';
import { publicVehicle, publicVehicleInclude } from '../src/lib/public-vehicle';
import { filterVehicles } from '../src/lib/market-types';
import { GET } from '../src/app/api/market/route';
import { samplePhotoPaths } from '../src/lib/sample-photos';
async function main() {
  if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL!).hostname))
    throw Error('Local database only');
  const rows = await db.vehicle.findMany({
    where: { isSample: true, status: 'ACTIVE' },
    include: publicVehicleInclude,
  });
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.deepEqual(row.images, samplePhotoPaths(Number(row.id.slice(-12))));
    assert.equal(new Set(row.images).size, row.images.length);
    assert.ok(row.fuelType);
  }
  const cases = [
    {},
    { make: 'Volkswagen', model: 'Golf 1.5 TSI', yearFrom: 2021, yearTo: 2021 },
    { specs: { fuelType: 'ELECTRIC' }, ranges: { electricConsumption: { max: 16 } } },
    { ranges: { fuelConsumption: { max: 6 }, powerKw: { min: 80 } } },
    { specs: { transmission: 'AUTOMATIC', warranty: 'YES' } },
    { minPrice: 20000, price: 30000, minMileage: 30000, mileage: 70000 },
    { query: '320d BMW' },
    { yearFrom: 2025, yearTo: 2020 },
    { equipment: ['NAVIGATION', 'REAR_CAMERA'], specs: { energyClass: 'ENERGY_A' } },
    { ranges: { seats: { min: 4.2, max: 5.5 } } },
  ];
  for (const item of cases) {
    const f = filterInput.parse({ privateOnly: false, ...item });
    const actual = await db.vehicle.findMany({
      where: { AND: [marketWhere(f), { isSample: true }] },
      select: { id: true },
    });
    const expected = filterVehicles(rows.map(publicVehicle), f);
    assert.deepEqual(actual.map((v) => v.id).sort(), expected.map((v) => v.id).sort());
  }
  const response = await GET(
    new Request(
      'http://localhost:3000/api/market?filters=' +
        encodeURIComponent(JSON.stringify({ privateOnly: false, specs: { fuelType: 'ELECTRIC' } })),
    ),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.total > 0);
  assert.ok(result.vehicles.every((v: { fuelType: string }) => v.fuelType === 'ELECTRIC'));
  assert.deepEqual(
    result.vehicles[0].images,
    samplePhotoPaths(Number(result.vehicles[0].id.slice(-12))),
  );
  const empty = await GET(new Request('http://localhost:3000/api/market?page=10000'));
  assert.equal((await empty.json()).vehicles.length, 0);
  const invalid = await GET(
    new Request(
      'http://localhost:3000/api/market?filters=' +
        encodeURIComponent(JSON.stringify({ specs: { userId: 'private' } })),
    ),
  );
  assert.equal(invalid.status, 400);
  console.log(
    'PASS: 12 licensed photo galleries; 10 database/client filter parity checks; API filtering, pagination and input validation. Read-only; no auction/payment test repeated.',
  );
}
main().finally(() => db.$disconnect());
