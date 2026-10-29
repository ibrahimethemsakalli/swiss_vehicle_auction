import { z } from 'zod';
// Locality only: no street, house number, coordinates or private address fields.
export const normalizeCity = (value: string) => value.normalize('NFC').trim().replace(/ +/g, ' ');
export const locationFields = {
  city: z
    .string()
    .transform(normalizeCity)
    .pipe(
      z
        .string()
        .max(80)
        .regex(/^(?:[\p{L}\p{M} .’'()/\-]*\p{L}[\p{L}\p{M} .’'()/\-]*)?$/u, 'validationCity'),
    )
    .nullable()
    .optional()
    .transform((value) => value || null),
  postalCode: z
    .string()
    .trim()
    .regex(/^(?:[1-9]\d{3})?$/, 'validationPostalCode')
    .nullable()
    .optional()
    .transform((value) => value || null),
};
export function localityText(vehicle: { city?: string | null; postalCode?: string | null }) {
  return [vehicle.postalCode, vehicle.city].filter(Boolean).join(' ');
}
export function matchesLocation(
  vehicle: { city?: string | null; postalCode?: string | null },
  filters: { city?: string; postalCode?: string },
) {
  return (
    (!filters.city ||
      normalizeCity(vehicle.city ?? '').toLowerCase() ===
        normalizeCity(filters.city).toLowerCase()) &&
    (!filters.postalCode || !!vehicle.postalCode?.startsWith(filters.postalCode))
  );
}
