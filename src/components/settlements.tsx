'use client';
import { Select, Textarea } from './ui/form-controls';
import { useState } from 'react';
import Link from 'next/link';
import { useLocale, type MessageKey } from './providers';
import { useResource, Loading, ErrorState, EmptyState, StatusBadge } from './common';
import { Button } from './ui/button';
import { PaymentHold } from './payment-hold';
import { DisputeForm } from './disputes';
type Sale = {
  id: string;
  vehicleId: string;
  vehicle: string;
  bidId: string;
  amount: number;
  status: string;
  outcome: string | null;
  seller: boolean;
  buyer: boolean;
  canReview: boolean;
  openDisputes: number;
  hold: { status: string; expiresAt: string };
};
export function Settlements() {
  const { t, money } = useLocale();
  const { data, loading, error, reload } = useResource<{
    settlements: Sale[];
    audits?: {
      id: string;
      createdAt: string;
      payload: { settlementId: string; action: string; note: string };
    }[];
  }>('/api/settlements');
  if (loading) return <Loading />;
  if (!data || error) return <ErrorState retry={reload} />;
  return (
    <section className="panel management-panel">
      <div className="flex justify-between flex-wrap gap-3">
        <h2>{t('settlements')}</h2>
        <Button variant="outline" onClick={reload}>
          {t('refreshSettlement')}
        </Button>
      </div>
      <p className="notice mb-4">{t('settlementHelp')}</p>
      {!data.settlements.length && <EmptyState />}
      {data.settlements.map((s) => (
        <article className="panel management-record" key={s.id}>
          <div className="flex justify-between gap-3 flex-wrap">
            <Link href={`/vehicles/${s.vehicleId}`}>{s.vehicle}</Link>
            <strong>{money(s.amount)}</strong>
            <StatusBadge status={s.status} />
          </div>
          <p className="fine-print mt-3">
            {t('holds')}: <StatusBadge status={s.hold.status} />
          </p>
          {s.buyer &&
            ['AWAITING_CONFIRMATION', 'DEFAULT_REVIEW', 'PAYMENT_FAILED'].includes(s.status) &&
            (s.hold.status !== 'AUTHORIZED' ||
              Date.parse(s.hold.expiresAt) < Date.now() + 86400000) && (
              <PaymentHold
                vehicleId={s.vehicleId}
                replacementBidId={s.bidId}
                onAuthorized={reload}
              />
            )}
          <SettlementActions sale={s} saved={reload} />
          {s.openDisputes > 0 &&
            [
              'AWAITING_CONFIRMATION',
              'DEFAULT_REVIEW',
              'CAPTURE_PENDING',
              'PAYMENT_FAILED',
            ].includes(s.status) && <p className="notice mt-3">{t('disputePausesCapture')}</p>}
          {(s.buyer || s.seller) && <DisputeForm settlementId={s.id} />}
          {data.audits
            ?.filter((a) => a.payload.settlementId === s.id)
            .map((a) => (
              <p className="fine-print mt-3" key={a.id}>
                {a.createdAt}:{' '}
                {t(
                  a.payload.action === 'retry' ? 'retryCapture' : (a.payload.action as MessageKey),
                )}{' '}
                — {a.payload.note}
              </p>
            ))}
        </article>
      ))}
    </section>
  );
}
function SettlementActions({ sale: s, saved }: { sale: Sale; saved: () => void }) {
  const { t } = useLocale();
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const actions = [
    ...(s.seller && s.status === 'AWAITING_CONFIRMATION' ? ['confirm', 'report_default'] : []),
    ...(s.canReview && s.status === 'DEFAULT_REVIEW' ? ['approve_default', 'dismiss_default'] : []),
    ...(s.canReview &&
    ['AWAITING_CONFIRMATION', 'DEFAULT_REVIEW', 'PAYMENT_FAILED'].includes(s.status)
      ? ['cancel']
      : []),
    ...(s.canReview && s.status === 'PAYMENT_FAILED' ? ['retry'] : []),
  ];
  if (!actions.length) return null;
  return (
    <form
      className="mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!consent || !actions.includes(action)) return;
        setBusy(true);
        setError(null);
        try {
          const response = await fetch('/api/settlements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: s.id, action, note }),
          });
          const result = await response.json();
          if (!response.ok) {
            setError(
              result.error === 'DISPUTE_OPEN'
                ? 'disputePausesCapture'
                : result.error === 'HOLD_RENEWAL_REQUIRED'
                  ? 'renewalRequired'
                  : 'settlementFailed',
            );
            return;
          }
          setAction('');
          setNote('');
          setConsent(false);
          saved();
        } catch {
          setError('settlementFailed');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="form-label">
        {t('settlementAction')}
        <Select
          required
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setConsent(false);
          }}
          className="field"
        >
          <option value="">{t('chooseAction')}</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {t(a === 'retry' ? 'retryCapture' : (a as MessageKey))}
            </option>
          ))}
        </Select>
      </label>
      <label className="form-label">
        {t('settlementReason')}
        <Textarea
          className="field"
          rows={4}
          required
          minLength={10}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
        />
        {t(
          action === 'confirm'
            ? 'completionConsent'
            : action === 'approve_default'
              ? 'defaultConsent'
              : 'decisionConsent',
        )}
      </label>
      <Button className="mt-3" disabled={busy || !consent || !actions.includes(action)}>
        {t(busy ? 'loading' : 'saveDecision')}
      </Button>
      {error && (
        <p role="alert" className="notice mt-3">
          {t(error)}
        </p>
      )}
    </form>
  );
}
