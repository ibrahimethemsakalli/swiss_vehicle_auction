'use client';
import { Select, Textarea } from './ui/form-controls';
import { useState } from 'react';
import { useLocale, type MessageKey } from './providers';
import { useResource, Loading, ErrorState, EmptyState, StatusBadge } from './common';
import { Button } from './ui/button';
export function DisputeForm({ settlementId }: { settlementId: string }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'disputeSent' | 'disputeFailed' | null>(null);
  return (
    <details className="mt-4">
      <summary className="cursor-pointer">{t('openDispute')}</summary>
      <p className="notice mt-3">{t('disputeHelp')}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = Object.fromEntries(new FormData(form));
          setBusy(true);
          setResult(null);
          try {
            const r = await fetch('/api/disputes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ settlementId, ...data }),
            });
            if (!r.ok) throw new Error();
            form.reset();
            setResult('disputeSent');
          } catch {
            setResult('disputeFailed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="form-label">
          {t('disputeCategory')}
          <Select name="category" className="border rounded-md p-2">
            {['NO_HANDOVER', 'VEHICLE_ISSUE', 'PAYMENT_ISSUE', 'OTHER'].map((v) => (
              <option key={v} value={v}>
                {t(v as MessageKey)}
              </option>
            ))}
          </Select>
        </label>
        <label className="form-label">
          {t('disputeMessage')}
          <Textarea
            name="message"
            className="w-full rounded-md border p-3"
            required
            minLength={20}
            maxLength={2000}
            rows={4}
          />
        </label>
        <Button disabled={busy}>{t('openDispute')}</Button>
      </form>
      {result && (
        <p className="notice mt-3" role="status">
          {t(result)}
        </p>
      )}
    </details>
  );
}
export function Disputes() {
  const { t } = useLocale();
  const r = useResource<{
    disputes: {
      id: string;
      vehicle: string;
      category: string;
      message: string;
      status: string;
      resolution: string | null;
      resolutionNote: string | null;
      canReview: boolean;
    }[];
  }>('/api/disputes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (r.loading) return <Loading />;
  if (!r.data) return <ErrorState retry={r.reload} />;
  return (
    <section className="panel management-panel">
      <h2>{t('disputes')}</h2>
      <p className="notice mb-4">{t('disputeHelp')}</p>
      {!r.data.disputes.length && <EmptyState />}
      {error && <p role="alert">{t('disputeFailed')}</p>}
      {r.data.disputes.map((d) => (
        <article key={d.id} className="panel management-record">
          <h3>{d.vehicle}</h3>
          <StatusBadge status={d.status} />
          <p>{t(d.category as MessageKey)}</p>
          <p className="whitespace-pre-wrap">{d.message}</p>
          {d.resolution && (
            <p className="notice">
              {t(d.resolution as MessageKey)} — {d.resolutionNote}
            </p>
          )}
          {d.canReview && ['OPEN', 'ACTION_REQUIRED'].includes(d.status) && (
            <form
              className="mt-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.currentTarget));
                setBusy(true);
                setError(false);
                try {
                  const response = await fetch('/api/disputes', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: d.id, ...data }),
                  });
                  if (!response.ok) throw new Error();
                  r.reload();
                } catch {
                  setError(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="form-label">
                {t('disputeResolution')}
                <Select name="resolution" className="field">
                  {['NO_ACTION', 'MANUAL_RESOLUTION', 'REFUND_REQUIRED'].map((v) => (
                    <option key={v} value={v}>
                      {t(v as MessageKey)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="form-label">
                {t('settlementReason')}
                <Textarea
                  name="note"
                  className="field"
                  required
                  minLength={20}
                  maxLength={2000}
                  rows={3}
                />
              </label>
              <label className="check-label">
                <input type="checkbox" required />
                {t('decisionConsent')}
              </label>
              <Button className="mt-3" disabled={busy}>
                {t('saveDecision')}
              </Button>
            </form>
          )}
        </article>
      ))}
    </section>
  );
}
