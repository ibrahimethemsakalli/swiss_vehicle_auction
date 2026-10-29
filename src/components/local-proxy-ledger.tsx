'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale, type MessageKey } from './providers';
import { Button } from './ui/button';
import {
  filterLedger,
  ledgerCsv,
  validLedgerDates,
  type LedgerReport,
} from '../lib/local-proxy-ledger-export';
type Report = LedgerReport;
const codes: Record<string, MessageKey> = {
  ORPHAN_RECORD: 'llOrphan',
  MISSING_CAPTURE: 'llMissingCapture',
  UNEXPECTED_CAPTURE: 'llUnexpectedCapture',
  DUPLICATE_CAPTURE: 'llDuplicateCapture',
  MULTIPLE_CAPTURED_HOLDS: 'llMultipleHolds',
  INVALID_CAPTURE: 'llInvalidCapture',
  CAPTURE_HOLD_MISMATCH: 'llHoldMismatch',
  UNLINKED_CAPTURED_HOLD: 'llUnlinkedHold',
  MISSING_REFUND: 'llMissingRefund',
  UNEXPECTED_REFUND: 'llUnexpectedRefund',
  DUPLICATE_REFUND: 'llDuplicateRefund',
  INVALID_REFUND: 'llInvalidRefund',
};
export function LocalProxyLedger() {
  const { t, money } = useLocale(),
    [data, setData] = useState<Report | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [onlyIssues, setOnlyIssues] = useState(false),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const filters = { from, to, onlyIssues };
  const validDates = validLedgerDates(filters);
  const filtered = data && validDates ? filterLedger(data, filters) : null;
  function download() {
    if (!data || !validDates || busy) return;
    const csv = ledgerCsv(data, filters, {
      title: t('llTitle'),
      scope: t('ljCsvScope'),
      checked: t('llChecked'),
      from: t('ljFrom'),
      to: t('ljTo'),
      all: t('ljAll'),
      onlyIssues: t('ljOnlyIssues'),
      yes: t('ljYes'),
      no: t('ljNo'),
      captured: t('llCaptured'),
      refunded: t('llRefunded'),
      net: t('llNet'),
      excluded: t('llExcluded'),
      auction: t('ljAuction'),
      kind: t('ljKind'),
      amount: t('ljAmount'),
      currency: t('ljCurrency'),
      at: t('ljAt'),
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'autoveri-local-ledger.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const revision = useRef(0);
  async function load() {
    const rev = ++revision.current;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/local-proxy?view=ledger', { cache: 'no-store' }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (rev === revision.current) setData(d);
    } catch (e) {
      if (rev === revision.current) {
        setData(null);
        setError(e instanceof Error ? e.message : '');
      }
    } finally {
      if (rev === revision.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, []);
  return (
    <section className="panel p-4 my-4 min-w-0 break-words" aria-label={t('llTitle')}>
      <h2 className="text-xl font-bold">{t('llTitle')}</h2>
      <p className="text-sm my-3">{t('llNotice')}</p>
      <Button disabled={busy} onClick={() => void load()}>
        {t('chatRefresh')}
      </Button>
      {busy && <p role="status">{t('loading')}</p>}
      {error && (
        <p role="alert">
          {t(
            error === 'LEDGER_TOO_LARGE'
              ? 'llTooLarge'
              : error === 'FORBIDDEN'
                ? 'lpForbidden'
                : 'lpFailed',
          )}
        </p>
      )}
      {data && (
        <>
          <p className="text-sm my-3">
            {t('llChecked')}: <time dateTime={data.checkedAt}>{data.checkedAt}</time>
          </p>
          <dl className="grid gap-3 sm:grid-cols-3 my-4">
            <div>
              <dt>{t('llCaptured')}</dt>
              <dd>
                {money(Number(data.captureCents) / 100)} ({data.captureCount})
              </dd>
            </div>
            <div>
              <dt>{t('llRefunded')}</dt>
              <dd>
                {money(Number(data.refundCents) / 100)} ({data.refundCount})
              </dd>
            </div>
            <div>
              <dt>{t('llNet')}</dt>
              <dd>{money(Number(data.netCents) / 100)}</dd>
            </div>
          </dl>
          <p>
            {t('llAuctions')}: {data.auctionCount} · {t('llExcluded')}: {data.excludedCurrencyCount}
          </p>
          <h3 className="font-bold mt-4">{t('llAudit')}</h3>
          {!data.issues.length ? (
            <p role="status">{t('llClean')}</p>
          ) : (
            <ul className="my-3 space-y-3">
              {data.issues.map((row) => (
                <li key={row.auctionId} className="border rounded-lg p-3">
                  <code className="break-all">{row.auctionId}</code>
                  <ul>
                    {row.issues.map((code) => (
                      <li key={code}>{t(codes[code] ?? 'lpFailed')}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-bold mt-4">{t('llEntries')}</h3>
          <p className="text-sm my-3" id="ledger-filter-scope">
            {t('ljScope')}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="min-w-0">
              {t('ljFrom')}
              <input
                type="date"
                className="block border rounded-lg p-2 w-full min-w-0"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                onInput={(e) => setFrom(e.currentTarget.value)}
                aria-invalid={!validDates}
                aria-describedby={!validDates ? 'ledger-date-error' : 'ledger-filter-scope'}
              />
            </label>
            <label className="min-w-0">
              {t('ljTo')}
              <input
                type="date"
                className="block border rounded-lg p-2 w-full min-w-0"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onInput={(e) => setTo(e.currentTarget.value)}
                aria-invalid={!validDates}
                aria-describedby={!validDates ? 'ledger-date-error' : 'ledger-filter-scope'}
              />
            </label>
          </div>
          {!validDates && (
            <p id="ledger-date-error" role="alert">
              {t('ljDatesError')}
            </p>
          )}
          <label className="flex items-center gap-2 my-3">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={(e) => setOnlyIssues(e.target.checked)}
            />
            {t('llOnlyIssues')}
          </label>
          <div className="flex flex-wrap gap-3 my-3">
            <Button
              onClick={() => {
                setFrom('');
                setTo('');
                setOnlyIssues(false);
              }}
            >
              {t('ljClear')}
            </Button>
            <Button disabled={busy || !validDates} onClick={download}>
              {t('ljDownload')}
            </Button>
          </div>
          {filtered && (
            <div aria-live="polite">
              <h3 className="font-bold">{t('ljTotals')}</h3>
              <p>
                {t('llCaptured')}: {money(Number(filtered.captureCents) / 100)} · {t('llRefunded')}:{' '}
                {money(Number(filtered.refundCents) / 100)} · {t('llNet')}:{' '}
                {money(Number(filtered.netCents) / 100)}
              </p>
              <p>
                {t('llExcluded')}: {filtered.excludedCurrencyCount}
              </p>
            </div>
          )}
          {filtered && !filtered.entries.length && <p>{t('llEmpty')}</p>}
          <ul className="space-y-3">
            {filtered?.entries.map((e, i) => (
              <li key={`${e.auctionId}-${e.kind}-${i}`} className="border rounded-lg p-3">
                <strong>{t(e.kind === 'CAPTURE' ? 'llCaptured' : 'llRefunded')}</strong> ·{' '}
                {e.currency === 'CHF'
                  ? money(e.amountCents / 100)
                  : `${e.amountCents / 100} ${e.currency}`}
                <p className="break-all">{e.auctionId}</p>
                <time className="text-sm" dateTime={e.at}>
                  {e.at}
                </time>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
