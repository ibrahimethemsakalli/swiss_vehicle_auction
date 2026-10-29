import type { Prisma, Vehicle } from '../generated/prisma/client';
export async function recordRevision(
  tx: Prisma.TransactionClient,
  vehicle: Vehicle,
  action: string,
  note = '',
  corrections: string[] = [],
) {
  // Never change existing snapshots. They are private to the owner/admin.
  const snapshot = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
  await tx.listingRevision.create({
    data: {
      vehicleId: vehicle.id,
      version: vehicle.version,
      action,
      note,
      corrections,
      snapshot: JSON.parse(JSON.stringify(snapshot)),
    },
  });
}
