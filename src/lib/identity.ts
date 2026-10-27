import { db } from './db';
export async function approveIdentity(adminId: string, userId: string, evidenceReference: string) {
  if (evidenceReference.trim().length < 10 || evidenceReference.length > 500 || adminId === userId)
    throw new Error('INVALID_REVIEW');
  return db.$transaction(async (tx) => {
    const admin = await tx.user.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.role !== 'ADMIN' || admin.suspendedAt) throw new Error('FORBIDDEN');
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      !user.phoneVerifiedAt ||
      !user.emailVerifiedAt ||
      user.suspendedAt ||
      user.isIdentityVerified ||
      (user.role === 'DEALER' && (!user.companyName || !user.handelsregisterNr))
    )
      throw new Error('INVALID_REVIEW');
    await tx.user.update({ where: { id: userId }, data: { isIdentityVerified: true } });
    await tx.outboxEvent.create({
      data: {
        kind: 'admin.identity',
        deliveredAt: new Date(),
        payload: { adminId, userId, evidenceReference },
      },
    });
  });
}
