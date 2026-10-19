import type { VehicleSpecs } from './vehicle-specs';
export type VehicleView = VehicleSpecs & {
  saleCancelled?: boolean;
  isSample?: boolean;
  id: string;
  make: string;
  model: string;
  firstRegistration: string | null;
  modelYear?: number | null;
  mileage: number;
  canton: string;
  mfkDate: string;
  images: string[];
  description: string;
  price: number;
  hasBids: boolean;
  increment: number;
  end: string | null;
  version: number;
  bidCount: number;
  sellerType: 'PRIVATE_USER' | 'DEALER';
  verified: boolean;
  stammnummer: string;
  maskedVin: string;
  powerKw: number | null;
  cubicCapacity: number | null;
  serviceHistory: string;
  tireCondition: string;
  listingType: 'AUCTION_7_DAYS' | 'FIXED_PRICE_OFFERS';
  status: string;
};
export const cantons = [
  'ZH',
  'BE',
  'LU',
  'UR',
  'SZ',
  'OW',
  'NW',
  'GL',
  'ZG',
  'FR',
  'SO',
  'BS',
  'BL',
  'SH',
  'AR',
  'AI',
  'SG',
  'GR',
  'AG',
  'TG',
  'TI',
  'VD',
  'VS',
  'NE',
  'GE',
  'JU',
];
export function vehicleYear(v: Pick<VehicleView, 'firstRegistration' | 'modelYear'>) {
  return (
    v.modelYear ?? (v.firstRegistration ? new Date(v.firstRegistration).getUTCFullYear() : null)
  );
}
export function isMfkFresh(date: string, now = new Date()) {
  const inspected = new Date(date);
  const threshold = new Date(now);
  threshold.setUTCFullYear(threshold.getUTCFullYear() - 1);
  return inspected <= now && inspected > threshold;
}
export type Filters = {
  make?: string;
  model?: string;
  minPrice?: number;
  minMileage?: number;
  yearFrom?: number;
  yearTo?: number;
  specs?: Record<string, string>;
  equipment?: string[];
  ranges?: Record<string, { min?: number; max?: number }>;
  query: string;
  canton: string;
  price: number;
  mileage: number;
  privateOnly: boolean;
  mfk: boolean;
  sort: string;
};
export function filterVehicles(vehicles: VehicleView[], f: Filters, now = new Date()) {
  return vehicles
    .filter(
      (v) =>
        f.query
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .every((token) => `${v.make} ${v.model}`.toLowerCase().includes(token)) &&
        (!f.canton || v.canton === f.canton) &&
        v.price <= f.price &&
        v.mileage <= f.mileage &&
        (!f.make || v.make === f.make) &&
        (!f.model || v.model === f.model) &&
        (f.minPrice === undefined || v.price >= f.minPrice) &&
        (f.minMileage === undefined || v.mileage >= f.minMileage) &&
        (!f.yearFrom || (vehicleYear(v) !== null && vehicleYear(v)! >= f.yearFrom)) &&
        (!f.yearTo || (vehicleYear(v) !== null && vehicleYear(v)! <= f.yearTo)) &&
        Object.entries(f.specs ?? {}).every(
          ([key, value]) => !value || v[key as keyof VehicleView] === value,
        ) &&
        (f.equipment ?? []).every((value) => v.equipment?.includes(value)) &&
        Object.entries(f.ranges ?? {}).every(([key, range]) => {
          if (range.min === undefined && range.max === undefined) return true;
          const value = v[key as keyof VehicleView];
          return (
            typeof value === 'number' &&
            (range.min === undefined || value >= range.min) &&
            (range.max === undefined || value <= range.max)
          );
        }) &&
        (!f.privateOnly || v.sellerType === 'PRIVATE_USER') &&
        (!f.mfk || (!v.isSample && isMfkFresh(v.mfkDate, now))),
    )
    .sort((a, b) =>
      f.sort === 'priceAsc'
        ? a.price - b.price
        : f.sort === 'priceDesc'
          ? b.price - a.price
          : (a.end ? Date.parse(a.end) : Infinity) - (b.end ? Date.parse(b.end) : Infinity),
    );
}
