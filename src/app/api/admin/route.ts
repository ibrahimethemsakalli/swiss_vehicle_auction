import { z } from 'zod';
import { pastDateInput } from '../../../lib/validation-inputs';
import { publicValidation } from '../../../lib/validation-errors';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { assertSameOrigin } from '../../../lib/mutation';
import { demoVehicles } from '../../../lib/demo';
import { sevenDaysFrom } from '../../../lib/auction-rules';
import { publicVehicle, publicVehicleInclude } from '../../../lib/public-vehicle';
export const dynamic = 'force-dynamic';
async function adminUser() {
  const id = await requireUser();
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.role !== 'ADMIN' || user.suspendedAt) throw new Error('FORBIDDEN');
  return id;
}
export async function GET() {
  if (!process.env.DATABASE_URL)
    return Response.json({
      demo: true,
      queue: demoVehicles()
        .slice(1, 3)
        .map((v) => ({ ...v, status: 'PENDING_VERIFICATION', vinChassis: 'WBA12345678901234' })),
      payments: [
        { id: 'demo-payment', vehicle: 'Porsche 911 Carrera', amount: 30, status: 'AUTHORIZED' },
      ],
    });
  try {
    await adminUser();
    const [queue, payments] = await Promise.all([
      db.vehicle.findMany({
        where: { status: 'PENDING_VERIFICATION' },
        include: publicVehicleInclude,
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      db.paymentHold.findMany({
        select: {
          id: true,
          status: true,
          amount: true,
          vehicle: { select: { make: true, model: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return Response.json(
      {
        demo: false,
        queue: queue.map((v) => ({ ...publicVehicle(v), vinChassis: v.vinChassis })),
        payments: payments.map((p) => ({
          ...p,
          amount: Number(p.amount),
          vehicle: `${p.vehicle.make} ${p.vehicle.model}`,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: 'DENIED' },
      {
        status:
          error instanceof Error && error.message === 'UNAUTHORIZED'
            ? 401
            : error instanceof Error && error.message === 'FORBIDDEN'
              ? 403
              : 503,
      },
    );
  }
}
const reviewInput = z
  .object({
    id: z.uuid(),
    action: z.enum(['approve', 'reject']),
    note: z.string().trim().min(5).max(2000),
    make: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(100),
    stammnummer: z.string().regex(/^\d{9}$/),
    vinChassis: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/),
    firstRegistration: pastDateInput,
    mfkDate: pastDateInput,
  })
  .strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const adminId = await adminUser();
    const input = reviewInput.parse(await request.json());
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${input.id} FOR UPDATE`;
      const old = await tx.vehicle.findUniqueOrThrow({
        where: { id: input.id },
        include: { user: true },
      });
      if (old.status !== 'PENDING_VERIFICATION') throw new Error('CONFLICT');
      if (
        input.action === 'approve' &&
        (old.user.suspendedAt ||
          !old.user.isIdentityVerified ||
          !old.user.phoneVerifiedAt ||
          (old.user.role === 'DEALER' && !old.user.handelsregisterNr))
      )
        throw new Error('SELLER_NOT_VERIFIED');
      const { id, action, note, ...fields } = input;
      const now = new Date();
      await tx.vehicle.update({
        where: { id },
        data: {
          ...fields,
          status: action === 'approve' ? 'ACTIVE' : 'CANCELLED',
          isVerifiedPrivate: old.user.role === 'PRIVATE_USER' && old.user.isIdentityVerified,
          ...(action === 'approve' && old.listingType === 'AUCTION_7_DAYS'
            ? { auctionStartAt: now, auctionEndsAt: sevenDaysFrom(now) }
            : {}),
          version: { increment: 1 },
        },
      });
      // Audit records are retained, never broadcast to public socket rooms.
      await tx.outboxEvent.create({
        data: {
          kind: 'admin.review',
          deliveredAt: now,
          payload: {
            adminId,
            vehicleId: id,
            action,
            note,
            previous: {
              make: old.make,
              model: old.model,
              stammnummer: old.stammnummer,
              vinChassis: old.vinChassis,
              firstRegistration: old.firstRegistration?.toISOString() ?? null,
              mfkDate: old.mfkDate.toISOString(),
            },
            updated: {
              ...fields,
              firstRegistration: fields.firstRegistration.toISOString(),
              mfkDate: fields.mfkDate.toISOString(),
            },
          },
        },
      });
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: 'REVIEW_REJECTED',
        ...(error instanceof z.ZodError ? { validation: publicValidation(error) } : {}),
      },
      {
        status:
          error instanceof Error && error.message === 'UNAUTHORIZED'
            ? 401
            : error instanceof Error && error.message === 'FORBIDDEN'
              ? 403
              : 400,
      },
    );
  }
}
