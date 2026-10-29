'use client';
import { useState } from 'react';
import { useLocale, type MessageKey } from './providers';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { cents, startSimulation, simulateBid, type SimState } from '../lib/proxy-simulation';
const errors: Record<string, MessageKey> = {
  INVALID_INPUT: 'proxyInvalid',
  BID_TOO_LOW: 'proxyTooLow',
  AUCTION_ENDED: 'proxyEnded',
  INVALID_HOLD: 'proxyHoldInvalid',
  LEADER_HOLD_EXPIRED: 'proxyHoldExpired',
  LIMIT_NOT_HIGHER: 'proxyRaiseOnly',
  REQUEST_CONFLICT: 'proxyConflict',
  SIM_LIMIT: 'proxyInvalid',
};
export function ProxySimulator() {
  const { t, money } = useLocale();
  const [values, setValues] = useState({
    start: '1000',
    increment: '100',
    first: '3000',
    second: '3500',
    remaining: '120',
  });
  const [result, setResult] = useState<SimState | null>(null),
    [error, setError] = useState<MessageKey | null>(null);
  const fields = [
    ['start', 'proxyStart'],
    ['increment', 'proxyIncrement'],
    ['first', 'proxyFirst'],
    ['second', 'proxySecond'],
    ['remaining', 'proxyRemaining'],
  ] as const;
  return (
    <section className="container max-w-3xl py-8 min-w-0 break-words">
      <h1 className="text-2xl font-bold">{t('proxyTitle')}</h1>
      <p className="notice my-4">{t('proxyNotice')}</p>
      <p className="my-4">{t('proxyRules')}</p>
      <p className="my-4">{t('proxyHoldRule')}</p>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          setError(null);
          try {
            if (!/^\d{1,3}$/.test(values.remaining) || Number(values.remaining) > 600)
              throw Error('INVALID_INPUT');
            let s = startSimulation(cents(values.start), cents(values.increment));
            s = simulateBid(s, {
              requestId: 'first',
              bidder: 'A',
              maximum: cents(values.first),
              now: 0,
              holdExpiresAt: 3600000,
            });
            s = simulateBid(s, {
              requestId: 'second',
              bidder: 'B',
              maximum: cents(values.second),
              now: 600000 - Number(values.remaining) * 1000,
              holdExpiresAt: 3600000,
            });
            setResult(s);
          } catch (e) {
            setError(errors[e instanceof Error ? e.message : ''] ?? 'proxyInvalid');
          }
        }}
      >
        {fields.map(([key, label]) => (
          <label key={key}>
            {t(label)}
            <Input
              value={values[key]}
              inputMode={key === 'remaining' ? 'numeric' : 'decimal'}
              maxLength={12}
              onChange={(e) => {
                setValues({ ...values, [key]: e.target.value });
                setResult(null);
                setError(null);
              }}
            />
          </label>
        ))}
        <Button type="submit" className="self-end">
          {t('proxyRun')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="notice my-4">
          {t(error)}
        </p>
      )}
      {result && (
        <section aria-live="polite" className="panel p-4 mt-6">
          <h2 className="font-bold">{t('proxyResult')}</h2>
          <p>
            {t('proxyLeader')}: {result.leader?.bidder} · {money(result.price! / 100)}
          </p>
          <p>
            {t('proxyEnd')}: {result.endsAt / 1000} s
          </p>
          <ol className="grid gap-4 mt-4">
            {result.history.map((h, i) => (
              <li className="border rounded-lg p-3" key={h.command.requestId}>
                <strong>
                  {i + 1}. {h.command.bidder} · {h.command.now / 1000} s
                </strong>
                <p>
                  {t('proxyLeader')}: {h.leader} · {money(h.price / 100)}
                </p>
                <p>{t(h.extended ? 'proxyExtended' : 'proxyUnchanged')}</p>
                <p>{h.release ? `${t('proxyReleased')}: ${h.release}` : t('proxyKept')}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
