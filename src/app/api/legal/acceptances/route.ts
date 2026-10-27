import { db } from '../../../../lib/db';
import { requireUser, apiError } from '../../../../lib/http';
import { assertSameOrigin } from '../../../../lib/mutation';
import { acceptCurrentLegal, legalSummary } from '../../../../lib/legal';
import { legalLocales } from '../../../../lib/legal-policy';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const userId = await requireUser();
    const user = await db.user.findUnique({ where: { id: userId }, select: { suspendedAt: true } });
    if (!user || user.suspendedAt) throw Error('FORBIDDEN');
    const lang = z.enum(legalLocales).parse(new URL(request.url).searchParams.get('lang') ?? 'de');
    const [current, receipts] = await Promise.all([
      legalSummary(lang),
      db.legalAcceptance.findMany({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
        take: 50,
        include: {
          release: { select: { version: true } },
          termsDocument: { select: { contentHash: true } },
          privacyDocument: { select: { contentHash: true } },
        },
      }),
    ]);
    return Response.json(
      {
        current,
        receipts: receipts.map((r) => ({
          id: r.id,
          version: r.release.version,
          releaseId: r.releaseId,
          locale: r.locale,
          acceptedAt: r.acceptedAt,
          source: r.source,
          termsHash: r.termsDocument.contentHash,
          privacyHash: r.privacyDocument.contentHash,
          termsAccepted: r.termsAccepted,
          privacyAcknowledged: r.privacyAcknowledged,
          eligibilityDeclared: r.eligibilityDeclared,
        })),
      },
      { headers: { 'Cache-Control': 'private,no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const receipt = await acceptCurrentLegal(await requireUser(), await request.json());
    return Response.json(
      { id: receipt.id, acceptedAt: receipt.acceptedAt },
      { headers: { 'Cache-Control': 'private,no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
