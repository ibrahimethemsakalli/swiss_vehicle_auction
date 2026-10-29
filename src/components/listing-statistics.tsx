'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useLocale } from './providers';
import { useResource, ErrorState, Loading } from './common';
import { Button } from './ui/button';
type Statistics = {
  page: number;
  total: number;
  since: string;
  until: string;
  collectionEnabled: boolean;
  rows: {
    id: string;
    make: string;
    model: string;
    views: number | null;
    favorites: number;
    contacts: number;
  }[];
};
export function ListingStatistics() {
  const { t, number, date } = useLocale();
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useResource<Statistics>(
    `/api/listing-statistics?page=${page}`,
  );
  if (error === 401)
    return (
      <div className="container py-8">
        <h1>{t('signInRequired')}</h1>
        <Link href="/login?next=/statistics">{t('login')}</Link>
      </div>
    );
  return (
    <div className="container py-8 min-w-0">
      <h1 className="text-2xl font-bold break-words">{t('listingStatsTitle')}</h1>
      <p className="my-4">{t('listingStatsScope')}</p>
      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorState code={error} retry={reload} />
      ) : (
        <>
          <p className="notice mb-4">
            {t(data.collectionEnabled ? 'listingStatsLocal' : 'listingStatsDisabled')}
          </p>
          <p className="mb-4">
            {t('listingStatsPeriod', { from: date(data.since), to: date(data.until) })}
          </p>
          {!data.rows.length && <p>{t('listingStatsEmpty')}</p>}
          <div className="grid gap-4">
            {data.rows.map((row) => (
              <section key={row.id} className="panel min-w-0 p-4">
                <h2 className="font-bold break-words">
                  {row.make} {row.model}
                </h2>
                <dl className="grid gap-4 sm:grid-cols-3 mt-4">
                  {(
                    [
                      ['listingStatsViews', row.views],
                      ['listingStatsFavorites', row.favorites],
                      ['listingStatsContacts', row.contacts],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="break-words">{t(label)}</dt>
                      <dd className="text-2xl font-bold">{value === null ? '—' : number(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <nav
            className="flex flex-wrap items-center gap-3 my-5"
            aria-label={t('listingStatsTitle')}
          >
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('listingStatsPrevious')}
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil(data.total / 20))}
            </span>
            <Button
              variant="outline"
              disabled={page * 20 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('listingStatsNext')}
            </Button>
            <Button variant="outline" onClick={reload}>
              {t('listingStatsRefresh')}
            </Button>
          </nav>
        </>
      )}
      <Link href="/dashboard">{t('garage')}</Link>
    </div>
  );
}
export function ListingViewTracker({ id, eligible }: { id: string; eligible: boolean }) {
  const { status } = useSession();
  const { data } = useResource<{ enabled: boolean }>('/api/local-test');
  useEffect(() => {
    if (!eligible || status !== 'authenticated' || !data?.enabled) return;
    let sent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!sent && document.visibilityState === 'visible')
        timer = setTimeout(() => {
          sent = true;
          void fetch('/api/listing-statistics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vehicleId: id }),
          }).catch(() => {});
        }, 5000);
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [id, eligible, status, data?.enabled]);
  return null;
}
