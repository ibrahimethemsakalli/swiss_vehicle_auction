import type { PrismaClient } from '../generated/prisma/client';
import { assertPublicationReady, legalHash, legalLocales, type LegalContent } from './legal-policy';
import type { LaunchEnv } from './launch-gate';

export async function readLaunchDatabase(db: PrismaClient, env: LaunchEnv) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const issues: string[] = [];
      const counts = {
        sampleUsers: await tx.user.count({
          where: {
            OR: [
              { isSample: true },
              { email: { endsWith: '@local.autoveri.test', mode: 'insensitive' } },
              { phone: { startsWith: 'LOCAL-' } },
            ],
          },
        }),
        sampleVehicles: await tx.vehicle.count({
          where: { OR: [{ isSample: true }, { description: { startsWith: 'LOCAL E2E TEST' } }] },
        }),
        syntheticHolds: await tx.paymentHold.count({
          where: { gateway: { in: ['fake', 'local-test', 'local-proxy'] } },
        }),
        proxyAuctions: await tx.localProxyAuction.count(),
        testRefundCaptures: await tx.refundCaptureState.count({
          where: { snapshot: { path: ['scope', 'environment'], equals: 'test' } },
        }),
      };
      for (const [key, count] of Object.entries(counts))
        if (count) issues.push(`SYNTHETIC_DATA_${key}`);
      const current = await tx.legalCurrent.findUnique({
        where: { id: 'current' },
        include: { release: { include: { documents: true } } },
      });
      const release = current?.release;
      if (!release || release.version !== env.LAUNCH_LEGAL_VERSION)
        issues.push('LEGAL_PUBLICATION_MISMATCH');
      else {
        try {
          for (const locale of legalLocales)
            for (const kind of ['TERMS', 'PRIVACY']) {
              const doc = release.documents.find((d) => d.locale === locale && d.kind === kind);
              if (!doc) throw Error('missing');
              const content = doc.content as unknown as LegalContent;
              if (legalHash(content) !== doc.contentHash) throw Error('hash');
              assertPublicationReady(content.operator);
              if (new URL(content.operator.domain!).origin !== new URL(env.PUBLIC_SITE_URL!).origin)
                throw Error('domain');
            }
        } catch {
          issues.push('LEGAL_PUBLICATION_INVALID');
        }
      }
      return { issues, counts };
    },
    { isolationLevel: 'RepeatableRead', timeout: 10000 },
  );
}
