import type { VehicleView } from './market-types';

// Timestamp means the server received a seller declaration, not that a fact was verified.
export function declarationStamp(now = new Date()) {
  return { dataDeclaredAt: now, dataCorrectedAt: null, dataCorrectedFields: [] as string[] };
}
export const correctionFieldLabels = {
  make: 'make',
  model: 'model',
  stammnummer: 'stammnummer',
  vinChassis: 'vin',
  firstRegistration: 'registration',
  mfkDate: 'inspection',
  mfkStatus: 'inspection',
} as const;
export function manualCorrectionStamp(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  now = new Date(),
) {
  const normalized = (value: unknown) =>
    value instanceof Date ? value.toISOString() : (value ?? null);
  const changed = Object.keys(correctionFieldLabels).filter(
    (key) => normalized(before[key]) !== normalized(after[key]),
  );
  return changed.length ? { dataCorrectedAt: now, dataCorrectedFields: changed } : {};
}
export function vehicleDataOrigin(vehicle: Pick<VehicleView, 'isSample' | 'dataDeclaredAt'>) {
  if (vehicle.isSample)
    return {
      source: 'SAMPLE_REFERENCE' as const,
      recordedAt: null,
      independentlyVerified: false as const,
    };
  const date = vehicle.dataDeclaredAt;
  if (date && Number.isFinite(Date.parse(date)))
    return {
      source: 'SELLER_DECLARATION' as const,
      recordedAt: date,
      independentlyVerified: false as const,
    };
  return { source: 'UNRECORDED' as const, recordedAt: null, independentlyVerified: false as const };
}
