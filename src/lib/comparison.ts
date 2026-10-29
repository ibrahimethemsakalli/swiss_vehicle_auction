import type { VehicleView } from './market-types';
import { equipmentOptions, specNumbers, specOptions } from './vehicle-specs';
export const comparisonLimit = 3;
const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  (/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id) || /^demo-\d{1,3}$/.test(id));
export function comparisonIds(raw: string | null): string[] {
  try {
    const ids: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(ids) ? [...new Set(ids.filter(validId))].slice(0, comparisonLimit) : [];
  } catch {
    return [];
  }
}
export function toggleComparison(ids: string[], id: string) {
  if (!validId(id)) return ids;
  if (ids.includes(id)) return ids.filter((value) => value !== id);
  return ids.length < comparisonLimit ? [...ids, id] : ids;
}
export function comparisonStatus(v: VehicleView, now: number) {
  if (v.saleCancelled) return 'CANCELLED';
  if (v.status === 'ACTIVE' && v.end && Date.parse(v.end) <= now) return 'auctionChecking';
  return ['ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED'].includes(v.status)
    ? v.status
    : 'compareUnknown';
}
export type ComparisonRow = {
  key: string;
  label: string;
  unit?: string;
  kind: 'number' | 'date' | 'option' | 'equipment' | 'mfk' | 'text';
};
export const comparisonRows: ComparisonRow[] = [
  { key: 'city', label: 'locationCity', kind: 'text' },
  { key: 'postalCode', label: 'locationPostalCode', kind: 'text' },
  { key: 'modelYear', label: 'modelYear', kind: 'number' },
  { key: 'firstRegistration', label: 'registration', kind: 'date' },
  { key: 'mileage', label: 'mileage', unit: 'km', kind: 'number' },
  { key: 'powerKw', label: 'power', unit: 'kW', kind: 'number' },
  { key: 'cubicCapacity', label: 'capacity', unit: 'cm³', kind: 'number' },
  { key: 'mfkDate', label: 'mfkStatus', kind: 'mfk' },
  ...Object.keys(specOptions).map((key) => ({ key, label: key, kind: 'option' as const })),
  ...Object.entries(specNumbers).map(([key, value]) => ({
    key,
    label: key,
    unit: value[3],
    kind: 'number' as const,
  })),
  ...equipmentOptions.map((key) => ({ key, label: key, kind: 'equipment' as const })),
];
export function comparisonValue(
  v: VehicleView,
  row: ComparisonRow,
): { value?: number | string; message?: string } {
  const value = v[row.key as keyof VehicleView];
  if (row.kind === 'text')
    return typeof value === 'string' && value.trim() ? { value } : { message: 'compareUnknown' };
  if (row.kind === 'equipment')
    return { message: v.equipment?.includes(row.key) ? 'compareListed' : 'compareNotSpecified' };
  if (row.kind === 'mfk') {
    if (v.isSample) return { message: 'compareUnverified' };
    if (v.mfkStatus === 'NEVER') return { message: 'mfkNever' };
    if (v.mfkStatus !== 'DATED') return { message: 'compareUnknown' };
  }
  if (row.kind === 'date' || row.kind === 'mfk')
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? { value }
      : { message: 'compareUnknown' };
  if (row.kind === 'number')
    return typeof value === 'number' && Number.isFinite(value)
      ? { value }
      : { message: 'compareUnknown' };
  const options = specOptions[row.key as keyof typeof specOptions] as readonly string[] | undefined;
  return typeof value === 'string' && value !== 'UNKNOWN' && options?.includes(value)
    ? { message: value }
    : { message: 'compareUnknown' };
}
