'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useLocale, type MessageKey } from './providers';
import type { ReconciliationReport } from '../lib/refund-reconciliation';
const money = (s: string) => `${BigInt(s) / 100n}.${String(BigInt(s) % 100n).padStart(2, '0')} CHF`;
export function ReconciliationView({
  report,
  t,
}: {
  report: ReconciliationReport;
  t: (key: MessageKey) => string;
}) {
  return (
    <div className="space-y-4 min-w-0 break-words">
      <p className="rounded border p-3">{t('rfOpsTargets')}</p>
      <p>{t('rcPageTotals')}</p>
      <p>
        {t('rcAt')} {report.asOf}
      </p>
      {report.incomplete && <p role="alert">{t('rcIncomplete')}</p>}
      {Object.entries(report.totals).map(([environment, total]) => (
        <section key={environment} className="border rounded p-3">
          <h2 className="font-semibold">{t(environment === 'test' ? 'rcTest' : 'rcLive')}</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(['captured', 'refunded', 'reserved', 'receipts'] as const).map((key) => (
              <div key={key}>
                <dt>
                  {t(
                    (
                      {
                        captured: 'rcCaptured',
                        refunded: 'rcRefunded',
                        reserved: 'rcReserved',
                        receipts: 'rcReceipts',
                      } as const
                    )[key],
                  )}
                </dt>
                <dd>{money(total[key])}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {!report.rows.length && <p>{t('rcEmpty')}</p>}
      <ul className="space-y-3">
        {report.rows.map((row) => (
          <li key={row.id} className="border rounded p-3">
            <h2 className="break-all font-semibold">{row.id}</h2>
            <p>
              {t(
                row.environment === 'test'
                  ? 'rcTest'
                  : row.environment === 'live'
                    ? 'rcLive'
                    : 'rcUnknown',
              )}
            </p>
            {row.codes.length ? (
              <ul className="list-disc pl-5">
                {row.codes.map((code) => (
                  <li key={code}>{t(('rc' + code) as MessageKey)}</li>
                ))}
              </ul>
            ) : (
              <p>{t('rcMatched')}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
export function RefundReconciliation() {
  const { t } = useLocale(),
    { status, data: session } = useSession();
  const id = (session?.user as { id?: string } | undefined)?.id;
  const [report, setReport] = useState<ReconciliationReport | null>(null),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const seq = useRef(0);
  async function load(n: number) {
    const run = ++seq.current;
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const r = await fetch(`/api/refunds/reconciliation?page=${n}`, { cache: 'no-store' }),
        v = await r.json();
      if (run !== seq.current) return;
      if (!r.ok) throw Error(v.error);
      setReport(v);
      setPage(n);
    } catch (e) {
      if (run === seq.current) setError(e instanceof Error ? e.message : 'UNAVAILABLE');
    } finally {
      if (run === seq.current) setBusy(false);
    }
  }
  useEffect(() => {
    setReport(null);
    if (status === 'authenticated') void load(1);
    return () => {
      seq.current++;
    };
  }, [status, id]);
  return (
    <section className="mx-auto max-w-4xl p-4 space-y-4 min-w-0">
      <h1 className="font-bold text-2xl">{t('rcTitle')}</h1>
      <p>{t('rcScope')}</p>
      <p className="p-3 bg-amber-50 rounded">{t('rcReadOnly')}</p>
      {status === 'unauthenticated' ? (
        <Link href="/login?next=/admin/refunds/reconciliation">{t('rfSignIn')}</Link>
      ) : (
        <>
          {error && (
            <p role="alert">
              {t(error === 'FORBIDDEN' || error === 'UNAUTHORIZED' ? 'rcDenied' : 'rfUnavailable')}
            </p>
          )}
          {(busy || status === 'loading') && <p role="status">{t('loading')}</p>}
          {report && <ReconciliationView report={report} t={t} />}
          <nav className="flex flex-wrap gap-3" aria-label={t('rfPages')}>
            <button
              disabled={busy || status !== 'authenticated' || page <= 1}
              onClick={() => void load(page - 1)}
            >
              {t('rfPrevious')}
            </button>
            <span>{page}</span>
            <button disabled={busy || status !== 'authenticated'} onClick={() => void load(page)}>
              {t('rfRefresh')}
            </button>
            <button disabled={busy || !report?.more} onClick={() => void load(page + 1)}>
              {t('rfNext')}
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
