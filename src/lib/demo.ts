import type { VehicleView } from './market-types';
import { samplePhotoPaths } from './sample-photos';
import { sampleFacts } from './sample-facts';
export function demoHistory(vehicle: VehicleView) {
  return Array.from({ length: Math.min(vehicle.bidCount, 10) }, (_, i) => ({
    id: `${vehicle.id}-bid-${i}`,
    amount: vehicle.price - i * vehicle.increment,
    createdAt: new Date(Date.now() - (i + 1) * 1800000).toISOString(),
  }));
}
// Deliberately fictional listings. Only used when DATABASE_URL is absent.
const galleries = [1, 2, 3, 9, 6, 10];
export function demoVehicles(): VehicleView[] {
  const now = Date.now();
  return [
    [48200, 'ZH', 21900, 17],
    [68500, 'BE', 24700, 9],
    [56200, 'LU', 29800, 12],
    [71000, 'VD', 42900, 6],
    [39500, 'ZG', 20900, 4],
    [82400, 'GE', 28900, 8],
  ].map((row, i) => ({
    id: `demo-${i + 1}`,
    mileage: Number(row[0]),
    canton: String(row[1]),
    price: Number(row[2]),
    bidCount: Number(row[3]),
    images: samplePhotoPaths(galleries[i]),
    mfkDate: new Date(now - (i === 3 ? 450 : 75 + i * 20) * 86400000).toISOString(),
    hasBids: true,
    increment: 100,
    end: new Date(now + (i === 0 ? 7800 : 84000 + i * 23400) * 1000).toISOString(),
    version: 1,
    sellerType: i === 5 ? 'DEALER' : 'PRIVATE_USER',
    verified: true,
    stammnummer: '000000000',
    maskedVin: '•••••••••••••1234',
    serviceHistory: 'FULL',
    tireCondition: '',
    listingType: 'AUCTION_7_DAYS',
    status: 'ACTIVE',
    isSample: true,
    ...sampleFacts(galleries[i]),
  }));
}
