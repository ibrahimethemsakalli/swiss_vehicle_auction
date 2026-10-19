import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db } from '../src/lib/db';
import { createVehicle } from '../src/lib/vehicles';
import { publicVehicle, publicVehicleInclude } from '../src/lib/public-vehicle';
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/autoveri'
  )
    throw Error('Local fixture database required');
  const user = await db.user.findUniqueOrThrow({
    where: { email: 'private_user@local.autoveri.test' },
  });
  let id: string | undefined;
  try {
    const result = await createVehicle(user.id, {
      stammnummer: '999999998',
      vinChassis: 'TEST' + randomBytes(7).toString('hex').toUpperCase().slice(0, 13),
      make: 'LOCAL CATALOG TEST',
      model: 'Specification persistence',
      firstRegistration: '2022-01-01',
      mileage: 1000,
      canton: 'ZH',
      mfkDate: '2026-01-01',
      serviceHistory: 'FULL',
      tireCondition: 'Fictional test',
      description: 'Temporary catalogue test; never published.',
      images: ['https://example.test/front.jpg', 'https://example.test/rear.jpg'],
      listingType: 'AUCTION_7_DAYS',
      startPrice: '1000',
      fuelType: 'ELECTRIC',
      transmission: 'AUTOMATIC',
      bodyType: 'SEDAN',
      drivetrain: 'AWD',
      electricConsumption: 15.5,
      batteryCapacity: 60,
      rangeKm: 450,
      fuelConsumption: 0,
      co2Emissions: 0,
      seats: 5,
      doors: 4,
      energyClass: 'ENERGY_A',
      interiorColor: 'BLACK',
      exteriorColor: 'WHITE',
      equipment: ['REAR_CAMERA', 'ISOFIX'],
      warranty: 'YES',
      accidentHistory: 'ACCIDENT_FREE',
      condition: 'USED',
    });
    id = result.id;
    const record = await db.vehicle.findUniqueOrThrow({
      where: { id },
      include: publicVehicleInclude,
    });
    assert.equal(record.status, 'PENDING_VERIFICATION');
    const view = publicVehicle(record);
    assert.equal(view.electricConsumption, 15.5);
    assert.equal(view.co2Emissions, 0);
    assert.equal(view.batteryCapacity, 60);
    assert.deepEqual(view.equipment, ['REAR_CAMERA', 'ISOFIX']);
    assert.equal(view.images.length, 2);
    console.log(
      'PASS: new listing specifications persist through creation, PostgreSQL and public DTO. Temporary unpublished fixture removed.',
    );
  } finally {
    if (id) await db.vehicle.delete({ where: { id } });
  }
}
main().finally(() => db.$disconnect());
