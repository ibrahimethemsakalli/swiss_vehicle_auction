'use client';
import { useState } from 'react';
import { useLocale } from './providers';
import { useResource, Loading, ErrorState, EmptyState } from './common';
import { Input } from './ui/input';
import { Button } from './ui/button';
export function IdentityReviews({ recordId }: { recordId?: string } = {}) {
  const { t } = useLocale();
  const resource = useResource<{
    users: {
      id: string;
      email: string;
      role: string;
      companyName: string | null;
      handelsregisterNr: string | null;
    }[];
  }>(
    recordId ? '/api/admin/identities?id=' + encodeURIComponent(recordId) : '/api/admin/identities',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (resource.loading) return <Loading />;
  if (!resource.data) return <ErrorState retry={resource.reload} />;
  return (
    <section className="panel">
      <h2>{t('identities')}</h2>
      <p className="notice mb-4">{t('identityReviewHelp')}</p>
      {error && <p role="alert">{t('reviewFailed')}</p>}
      {!resource.data.users.length && <EmptyState />}
      {resource.data.users.map((user) => (
        <form
          key={user.id}
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError(false);
            try {
              const response = await fetch('/api/admin/identities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, evidenceReference: form.get('reference') }),
              });
              if (!response.ok) throw new Error();
              resource.reload();
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <strong>{user.email}</strong>
          <p>
            {user.role} {user.companyName} {user.handelsregisterNr}
          </p>
          <label className="form-label">
            {t('evidenceReference')}
            <Input name="reference" required minLength={10} maxLength={500} />
          </label>
          <Button disabled={busy}>{t('approve')}</Button>
        </form>
      ))}
    </section>
  );
}
