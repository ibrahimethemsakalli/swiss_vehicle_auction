'use client';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useLocale } from './providers';
import { Button } from './ui/button';
import { RetentionProtections } from './retention-protections';
import type { readRetentionInventory } from '../lib/retention-inventory';
type Report = Awaited<ReturnType<typeof readRetentionInventory>>;
export function RetentionInventory() {
  const { data: session, status } = useSession();
  const { t } = useLocale();
  if (status === 'loading') return <p>{t('loading')}</p>;
  if (!session?.user?.email) return <p role="alert">{t('riError')}</p>;
  return <Inventory key={session.user.email} />;
}
function Inventory() {
  const { t } = useLocale();
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  async function load() {
    setBusy(true);
    setFailed(false);
    setReport(null);
    try {
      const r = await fetch('/api/admin/retention', { cache: 'no-store' });
      if (!r.ok) throw Error();
      setReport(await r.json());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel p-4 min-w-0 break-words">
      <h1 className="text-2xl font-bold">{t('riTitle')}</h1>
      <p className="my-3">{t('rdNotice')}</p>
      <p className="my-3">{t('rdRules')}</p>
      <p>{t('riProtection')}</p>
      <RetentionProtections onChange={() => setReport(null)} />
      <Button className="my-3" disabled={busy} onClick={() => void load()}>
        {t('chatRefresh')}
      </Button>
      {busy && <p role="status">{t('loading')}</p>}
      {failed && <p role="alert">{t('riError')}</p>}
      {report && (
        <>
          <p>
            {t('llChecked')}: {report.observedAt}
          </p>
          <dl className="grid gap-3 sm:grid-cols-4 my-4">
            {(['count', 'candidate', 'protected', 'unknown'] as const).map((key, i) => (
              <div key={key}>
                <dt>{t((['riRows', 'riCandidate', 'riProtected', 'riUnknown'] as const)[i])}</dt>
                <dd>{report.totals[key]}</dd>
              </div>
            ))}
          </dl>
          <p className="my-3">{t('riUnscanned')}</p>
          <dl className="grid gap-3 sm:grid-cols-2 my-4">
            {(['elapsed', 'evidence', 'notDue', 'unknown'] as const).map((key, i) => (
              <div key={key}>
                <dt>{t((['rdElapsed', 'rdEvidence', 'rdNotDue', 'rdUnknown'] as const)[i])}</dt>
                <dd>{report.messageAssessment[key]}</dd>
              </div>
            ))}
          </dl>
          <ul className="space-y-3">
            {report.rows.map((row) => (
              <li key={row.table} className="border rounded-lg p-3">
                <h2 className="font-bold break-all">
                  {t('riTable')}: {row.table}
                </h2>
                <p>
                  {t('riRows')}: {row.count} · {t('riCandidate')}: {row.candidate} ·{' '}
                  {t('riProtected')}: {row.protected} · {t('riUnknown')}: {row.unknown}
                </p>
                <p>
                  {t(
                    row.reason === 'evidence'
                      ? 'riEvidence'
                      : row.reason === 'messages'
                        ? 'rdRules'
                        : 'riUndefined',
                  )}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
