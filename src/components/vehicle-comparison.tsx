'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { VehicleView } from '../lib/market-types';
import { comparisonRows, comparisonStatus, comparisonValue } from '../lib/comparison';
import { useComparison } from './comparison-provider';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import { VehicleImage, SellerBadge } from './common';
type Entry = { id: string; vehicle?: VehicleView; unavailable?: boolean; failed?: boolean };
export function VehicleComparison() {
  const { ids, ready, toggle } = useComparison();
  const { t, number, money, date } = useLocale();
  const [snapshot, setSnapshot] = useState<{ key: string; items: Entry[] }>({ key: '', items: [] });
  const [revision, setRevision] = useState(0),
    [now, setNow] = useState(0);
  const key = ids.join(',');
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const items = await Promise.all(
        ids.map(async (id) => {
          try {
            const response = await fetch(`/api/market/${encodeURIComponent(id)}`, {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (response.status === 404) return { id, unavailable: true };
            if (!response.ok) throw Error();
            const data = await response.json();
            return { id, vehicle: data.vehicle as VehicleView };
          } catch {
            return { id, failed: true };
          }
        }),
      );
      if (!controller.signal.aborted) setSnapshot({ key, items });
      pending = false;
    };
    void refresh();
    const interval = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [key, revision]); // Selection key changes invalidate every in-flight response.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const entries: Entry[] = snapshot.key === key ? snapshot.items : ids.map((id) => ({ id }));
  const cell = (v: VehicleView, row: (typeof comparisonRows)[number]) => {
    const result = comparisonValue(v, row);
    if (result.message) return t(result.message as MessageKey);
    if (row.key === 'modelYear' && typeof result.value === 'number') return String(result.value);
    if (typeof result.value === 'number')
      return `${number(result.value)}${row.unit ? ' ' + row.unit : ''}`;
    return result.value
      ? row.kind === 'text'
        ? result.value
        : date(result.value)
      : t('compareUnknown');
  };
  return (
    <section className="container comparison-page">
      <h1>{t('compareTitle')}</h1>
      <p>{t('compareIntro')}</p>
      <Link href="/#vehicles">{t('backListings')}</Link>
      {!ready ? (
        <p role="status">{t('loading')}</p>
      ) : !ids.length ? (
        <p className="notice">{t('compareEmpty')}</p>
      ) : (
        <>
          <p id="comparison-scroll-hint" className="fine-print">
            {t('compareScroll')}
          </p>
          <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
            {t('compareRefresh')}
          </Button>
          <div
            className="comparison-scroll"
            role="region"
            aria-label={t('compareTitle')}
            aria-describedby="comparison-scroll-hint"
            tabIndex={0}
          >
            <table className="comparison-table">
              <caption className="sr-only">{t('compareTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('compareField')}</th>
                  {entries.map((entry, i) => (
                    <th scope="col" key={entry.id}>
                      {entry.vehicle ? (
                        <>
                          <VehicleImage
                            src={entry.vehicle.images[0]}
                            alt={`${entry.vehicle.make} ${entry.vehicle.model}`}
                            loading="lazy"
                          />
                          <Link href={`/vehicles/${entry.id}`}>
                            {entry.vehicle.make} {entry.vehicle.model}
                          </Link>
                          <SellerBadge vehicle={entry.vehicle} />
                        </>
                      ) : (
                        <p role="status">
                          {t(
                            entry.unavailable
                              ? 'compareUnavailable'
                              : entry.failed
                                ? 'compareLoadFailed'
                                : 'loading',
                          )}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => toggle(entry.id)}
                        aria-label={`${t('compareRemove')}: ${entry.vehicle ? entry.vehicle.make + ' ' + entry.vehicle.model : i + 1}`}
                      >
                        {t('compareRemove')}
                      </Button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{t('status')}</th>
                  {entries.map((e) => (
                    <td key={e.id}>
                      {e.vehicle
                        ? t(comparisonStatus(e.vehicle, now) as MessageKey)
                        : t('compareUnknown')}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{t('comparePrice')}</th>
                  {entries.map((e) => (
                    <td key={e.id}>
                      {e.vehicle ? (
                        <>
                          {Number.isFinite(e.vehicle.price)
                            ? money(e.vehicle.price)
                            : t('compareUnknown')}
                          <small>
                            {t(
                              e.vehicle.listingType === 'FIXED_PRICE_OFFERS'
                                ? 'fixedPrice'
                                : e.vehicle.hasBids
                                  ? 'currentBid'
                                  : 'startingPrice',
                            )}
                          </small>
                        </>
                      ) : (
                        t('compareUnknown')
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{t('canton')}</th>
                  {entries.map((e) => (
                    <td key={e.id}>{e.vehicle?.canton || t('compareUnknown')}</td>
                  ))}
                </tr>
                {comparisonRows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{t(row.label as MessageKey)}</th>
                    {entries.map((e) => (
                      <td key={e.id}>{e.vehicle ? cell(e.vehicle, row) : t('compareUnknown')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
