'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Button } from './ui/button';
import { useLocale } from './providers';
export function PaymentHold({
  vehicleId,
  replacementBidId,
  onAuthorized,
}: {
  vehicleId: string;
  replacementBidId?: string;
  onAuthorized: (id: string) => void;
}) {
  const { t, locale } = useLocale();
  const [checkout, setCheckout] = useState<{ holdId: string; clientSecret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [localTest, setLocalTest] = useState(false);
  useEffect(() => {
    fetch('/api/local-test')
      .then((r) => r.json())
      .then((data) => setLocalTest(data.enabled === true))
      .catch(() => {});
  }, []);
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const stripe = useMemo(() => (key ? loadStripe(key) : null), [key]);
  if (!stripe && !localTest) return <p className="notice mt-4">{t('paymentUnavailable')}</p>;
  return (
    <section className="mt-4">
      <p className="fine-print">{t(localTest ? 'localPaymentNotice' : 'authorizationHelp')}</p>
      {checkout ? (
        <Elements stripe={stripe} options={{ clientSecret: checkout.clientSecret, locale }}>
          <Checkout holdId={checkout.holdId} onAuthorized={onAuthorized} />
        </Elements>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          className="w-full mt-3"
          onClick={async () => {
            setBusy(true);
            setError(false);
            try {
              const r = await fetch('/api/payments/holds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'create', vehicleId, replacementBidId }),
              });
              if (!r.ok) throw new Error();
              const data = await r.json();
              if (data.localTest && data.status === 'AUTHORIZED') {
                onAuthorized(data.holdId);
                return;
              }
              if (!data.clientSecret) throw new Error();
              setCheckout(data);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t(
            busy
              ? 'loading'
              : localTest
                ? 'localAuthorize'
                : replacementBidId
                  ? 'renewHold'
                  : 'authorizeHold',
          )}
        </Button>
      )}
      {error && (
        <p role="alert" className="notice mt-3">
          {t('paymentFailed')} <Link href="/verify">{t('verifyAccount')}</Link>
        </p>
      )}
    </section>
  );
}
function Checkout({
  holdId,
  onAuthorized,
}: {
  holdId: string;
  onAuthorized: (id: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [consent, setConsent] = useState(false);
  return (
    <form
      className="mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements || !consent) return;
        setBusy(true);
        setError(false);
        try {
          const previous = await fetch('/api/payments/holds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm', holdId }),
          });
          if (previous.ok && (await previous.json()).status === 'AUTHORIZED') {
            onAuthorized(holdId);
            return;
          }
          const result = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: window.location.href },
            redirect: 'if_required',
          });
          if (result.error) throw new Error();
          const response = await fetch('/api/payments/holds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm', holdId }),
          });
          const data = await response.json();
          if (!response.ok || data.status !== 'AUTHORIZED') throw new Error();
          onAuthorized(holdId);
        } catch {
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <PaymentElement />
      <label className="check-label mt-4">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
        />
        {t('authorizationConsent')}
      </label>
      <Button className="w-full mt-3" disabled={busy || !stripe || !elements || !consent}>
        {t(busy ? 'loading' : 'authorizeHold')}
      </Button>
      {error && (
        <p role="alert" className="notice">
          {t('paymentFailed')}
        </p>
      )}
    </form>
  );
}
