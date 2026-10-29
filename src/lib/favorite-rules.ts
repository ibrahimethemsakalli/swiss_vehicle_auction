import { z } from 'zod';
export const favoriteLimit = 200;
export const favoritePublicStates = ['ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED'] as const;
export const favoriteCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), vehicleId: z.uuid(), saved: z.boolean() }).strict(),
  z
    .object({ action: z.literal('merge'), ids: z.array(z.string().max(100)).max(favoriteLimit) })
    .strict(),
]);
export function guestFavorites(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100,
            ),
          ),
        ].slice(0, favoriteLimit)
      : [];
  } catch {
    return [];
  }
}
