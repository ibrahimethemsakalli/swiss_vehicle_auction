import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  canonical,
  manifestSchema,
  pageSchema,
  previewSyntheticEvidence,
} from './refund-external-evidence';
const digest = (x: unknown) => createHash('sha256').update(canonical(x)).digest('hex');
const envelope = z.object({ manifest: z.unknown(), pages: z.array(z.unknown()).max(200) }).strict();
type Stored = {
  id: string;
  status: 'STAGED_SYNTHETIC' | 'QUARANTINED';
  summary: Record<string, unknown>;
};
/** Offline synthetic staging only. Never writes payment state, receipts, or production evidence. */
export class SyntheticEvidenceStore {
  constructor(private pool: Pool) {}
  protected async tx<T>(
    userId: string,
    write: boolean,
    fn: (tx: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (process.env.NODE_ENV === 'production') throw Error('LOCAL_SYNTHETIC_ONLY');
    const tx = await this.pool.connect();
    try {
      await tx.query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const database = (
        await tx.query('SELECT current_database() AS name,host(inet_server_addr()) AS host')
      ).rows[0];
      if (
        !['127.0.0.1', '::1'].includes(database.host) ||
        !/^autoveri(?:_[a-z0-9_]+_test|_test)?$/.test(database.name)
      )
        throw Error('LOCAL_SYNTHETIC_ONLY');
      const suffix = write ? ' FOR SHARE' : '';
      const config = (
        await tx.query('SELECT actors FROM "RefundRuntimePolicy" WHERE id=$1' + suffix, ['active'])
      ).rows[0];
      const u = (
        await tx.query('SELECT role,"suspendedAt","isSample" FROM "User" WHERE id=$1' + suffix, [
          userId,
        ])
      ).rows[0];
      const cap = write ? 'payment.evidence.import' : 'payment.reconcile';
      if (
        !u ||
        u.role !== 'ADMIN' ||
        u.suspendedAt ||
        u.isSample ||
        !Array.isArray(config?.actors) ||
        !config.actors.some(
          (a: any) =>
            a?.id === userId &&
            a.active === true &&
            Array.isArray(a.capabilities) &&
            (a.capabilities.includes(cap) ||
              (!write && a.capabilities.includes('payment.evidence.import'))),
        )
      )
        throw Error('FORBIDDEN');
      const result = await fn(tx);
      await tx.query('COMMIT');
      return result;
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    } finally {
      tx.release();
    }
  }
  async ingest(userId: string, requestId: string, json: string): Promise<Stored> {
    z.uuid().parse(requestId);
    if (Buffer.byteLength(json, 'utf8') > 2 * 1024 * 1024) throw Error('INPUT_LIMIT');
    const input = envelope.parse(JSON.parse(json)),
      manifest = manifestSchema.parse(input.manifest);
    if (manifest.scope.environment !== 'test') throw Error('LOCAL_SYNTHETIC_ONLY');
    const inputHash = digest(input),
      preview = previewSyntheticEvidence(manifest, input.pages);
    const scopeKey = canonical({ source: manifest.source, ...manifest.scope });
    // Complete batch identity ignores duplicate delivery and page ordering; request identity does not.
    const payloadHash = preview.contentHash ?? inputHash;
    return this.tx(userId, true, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        canonical(['evidence-request', userId, requestId]),
      ]);
      const retry = await tx.query(
        'SELECT a."inputHash",i.id,i.status,i.summary FROM "SyntheticEvidenceAttempt" a JOIN "SyntheticEvidenceImport" i ON i.id=a."importId" WHERE a."actorId"=$1 AND a."requestId"=$2',
        [userId, requestId],
      );
      if (retry.rowCount) {
        if (retry.rows[0].inputHash !== inputHash) throw Error('CONFLICT');
        const { inputHash: _, ...result } = retry.rows[0];
        return result as Stored;
      }
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        canonical(['evidence-scope', scopeKey]),
      ]);
      const previous = await tx.query(
        'SELECT id,status,summary FROM "SyntheticEvidenceImport" WHERE "scopeKey"=$1 AND "batchId"=$2 AND "payloadHash"=$3',
        [scopeKey, manifest.batchId, payloadHash],
      );
      let stored: Stored;
      if (previous.rowCount) stored = previous.rows[0];
      else {
        const findings: string[] = [...preview.findings];
        const accepted = (
          await tx.query(
            'SELECT 1 FROM "SyntheticEvidenceImport" WHERE "scopeKey"=$1 AND "batchId"=$2 AND status=$3',
            [scopeKey, manifest.batchId, 'STAGED_SYNTHETIC'],
          )
        ).rowCount;
        if (accepted) findings.push('BATCH_CONFLICT');
        const existingIds = new Map<string, string>();
        if (preview.status === 'COMPLETE_SYNTHETIC') {
          const existing = (
            await tx.query(
              'SELECT * FROM "SyntheticEvidenceEvent" WHERE "scopeKey"=$1 AND ("eventId"=ANY($2::text[]) OR "economicId"=ANY($3::text[]))',
              [
                scopeKey,
                preview.stagedEvents.map((e) => e.eventId),
                preview.stagedEvents.map((e) => e.economicId),
              ],
            )
          ).rows;
          for (const event of preview.stagedEvents) {
            const same = existing.find((e) => e.eventId === event.eventId),
              economic = existing.find((e) => e.economicId === event.economicId);
            if (same && same.contentHash !== digest(event)) findings.push('STORED_EVENT_CONFLICT');
            if (economic && economic.eventId !== event.eventId)
              findings.push('STORED_ECONOMIC_CONFLICT');
            if (same) existingIds.set(event.eventId, same.id);
          }
        }
        const status =
          preview.status === 'COMPLETE_SYNTHETIC' && !findings.length
            ? 'STAGED_SYNTHETIC'
            : 'QUARANTINED';
        const { stagedEvents: _, batchId: __, ...summary } = preview;
        const persistedSummary = {
          ...summary,
          findings: [...new Set(findings)],
          status,
          previewStatus: preview.status,
          authentic: false,
        };
        // Invalid/unscoped pages are never retained verbatim (could contain unexpected sensitive fields).
        const safePages = input.pages.map((p) => pageSchema.safeParse(p));
        const safe = safePages.every(
          (p) =>
            p.success &&
            p.data.batchId === manifest.batchId &&
            canonical(p.data.scope) === canonical(manifest.scope),
        );
        const id = randomUUID();
        await tx.query(
          'INSERT INTO "SyntheticEvidenceImport" (id,"scopeKey","batchId","payloadHash",status,manifest,pages,summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            scopeKey,
            manifest.batchId,
            payloadHash,
            status,
            JSON.stringify(manifest),
            safe ? JSON.stringify(safePages.map((p) => p.data)) : null,
            JSON.stringify(persistedSummary),
          ],
        );
        if (status === 'STAGED_SYNTHETIC')
          for (const event of preview.stagedEvents) {
            let eventId = existingIds.get(event.eventId);
            if (!eventId) {
              eventId = randomUUID();
              await tx.query(
                'INSERT INTO "SyntheticEvidenceEvent" (id,"scopeKey","eventId","economicId","contentHash",payload) VALUES ($1,$2,$3,$4,$5,$6)',
                [
                  eventId,
                  scopeKey,
                  event.eventId,
                  event.economicId,
                  digest(event),
                  JSON.stringify(event),
                ],
              );
            }
            await tx.query(
              'INSERT INTO "SyntheticEvidenceLink" ("importId","eventId") VALUES ($1,$2)',
              [id, eventId],
            );
          }
        stored = { id, status, summary: persistedSummary };
      }
      await tx.query(
        'INSERT INTO "SyntheticEvidenceAttempt" (id,"actorId","requestId","inputHash","importId") VALUES ($1,$2,$3,$4,$5)',
        [randomUUID(), userId, requestId, inputHash, stored.id],
      );
      return stored;
    });
  }
  async read(userId: string, id: string): Promise<Stored> {
    z.uuid().parse(id);
    return this.tx(userId, false, async (tx) => {
      const result = await tx.query(
        'SELECT id,status,summary FROM "SyntheticEvidenceImport" WHERE id=$1',
        [id],
      );
      if (!result.rowCount) throw Error('NOT_FOUND');
      return result.rows[0];
    });
  }
}
