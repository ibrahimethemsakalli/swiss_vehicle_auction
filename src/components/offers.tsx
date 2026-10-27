'use client';
import { Select } from './ui/form-controls';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useLocale } from './providers';
import { useResource, Loading, ErrorState, EmptyState, StatusBadge } from './common';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { PaymentHold } from './payment-hold';
export function OfferForm({
  vehicleId,
  price,
  disabled,
}: {
  vehicleId: string;
  price: number;
  disabled: boolean;
}) {
  const { t } = useLocale();
  const { status } = useSession();
  const [holdId, setHold] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'offerSent' | 'offerFailed' | null>(null);
  const request = useRef<{ key: string; id: string } | undefined>(undefined);
  if (disabled) return null;
  if (status !== 'authenticated')
    return (
      <Button asChild className="w-full mt-4">
        <Link href="/login">{t('login')}</Link>
      </Button>
    );
  return (
    <div className="mt-4">
      <p>{t('offerHelp')}</p>
      {!holdId && <PaymentHold vehicleId={vehicleId} onAuthorized={setHold} />}
      <form
        className="mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!holdId || !consent || busy) return;
          setBusy(true);
          setResult(null);
          const key = `${holdId}:${amount}`;
          if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
          try {
            const response = await fetch('/api/offers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                vehicleId,
                holdId,
                amount: Number(amount).toFixed(2),
                requestId: request.current.id,
              }),
            });
            if (!response.ok) throw new Error();
            setResult('offerSent');
            setHold(null);
            setConsent(false);
          } catch {
            setResult('offerFailed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="form-label">
          {t('offerAmount')}
          <Input
            type="number"
            min="0.01"
            max={price}
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          {t('bidConsent')}
        </label>
        <Button className="mt-4 w-full" disabled={!holdId || !consent || busy}>
          {t('sendOffer')}
        </Button>
      </form>
      {result && (
        <p className="notice mt-3" role="status">
          {t(result)} <Link href="/dashboard">{t('garage')}</Link>
        </p>
      )}
    </div>
  );
}
export function Offers() {
  const { t, money, date } = useLocale();
  const resource = useResource<{
    offers: {
      id: string;
      vehicleId: string;
      vehicle: string;
      amount: number;
      expiresAt: string;
      status: string;
      seller: boolean;
    }[];
  }>('/api/offers');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (resource.loading) return <Loading />;
  if (!resource.data) return <ErrorState retry={resource.reload} />;
  return (
    <section className="panel">
      <h2>{t('fixedOffers')}</h2>
      <p className="notice">{t('offerHelp')}</p>
      {error && <p role="alert">{t('offerFailed')}</p>}
      {!resource.data.offers.length && <EmptyState />}
      {resource.data.offers.map((o) => (
        <article className="panel" key={o.id}>
          <Link href={`/vehicles/${o.vehicleId}`}>{o.vehicle}</Link>
          <p>
            {money(o.amount)} · {date(o.expiresAt)}
          </p>
          <StatusBadge status={o.status} />
          {o.status === 'OFFER_PENDING' && (
            <form
              className="mt-3 flex gap-3 flex-wrap"
              onSubmit={async (e) => {
                e.preventDefault();
                const action = String(new FormData(e.currentTarget).get('action'));
                setBusy(true);
                setError(false);
                try {
                  const r = await fetch('/api/offers', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: o.id, action }),
                  });
                  if (!r.ok) throw new Error();
                  resource.reload();
                } catch {
                  setError(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Select
                name="action"
                className="border rounded-md p-2"
                aria-label={t('settlementAction')}
              >
                {o.seller ? (
                  <>
                    <option value="accept">{t('acceptOffer')}</option>
                    <option value="reject">{t('rejectOffer')}</option>
                  </>
                ) : (
                  <option value="withdraw">{t('withdrawOffer')}</option>
                )}
              </Select>
              <label className="check-label">
                <input type="checkbox" required />
                {t('decisionConsent')}
              </label>
              <Button disabled={busy}>{t('saveDecision')}</Button>
            </form>
          )}
        </article>
      ))}
    </section>
  );
}
