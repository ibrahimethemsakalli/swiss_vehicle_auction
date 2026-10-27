'use client';
import { useState } from 'react';
import { useLocale } from './providers';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ValidationErrors } from './validation-errors';
import { readValidation, type ValidationIssue } from '../lib/validation-public';

export function EmailSecurity({ reset = false }: { reset?: boolean }) {
  const { t } = useLocale();
  const { status } = useSession();
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<ValidationIssue[]>([]);
  const [result, setResult] = useState<
    'messageRequested' | 'securitySuccess' | 'securityFailed' | null
  >(null);
  async function submit(e: React.FormEvent<HTMLFormElement>, requestOnly: boolean) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setResult(null);
    setValidation([]);
    try {
      const response = await fetch('/api/account-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          action: requestOnly
            ? reset
              ? 'requestReset'
              : 'requestEmail'
            : reset
              ? 'reset'
              : 'verifyEmail',
        }),
      });
      if (!response.ok) {
        setValidation(readValidation(await response.json().catch(() => ({}))));
        throw new Error();
      }
      setResult(requestOnly ? 'messageRequested' : 'securitySuccess');
    } catch {
      setResult('securityFailed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel login-card mb-6"
      style={{ overflowWrap: 'anywhere' }}
      onInput={() => setValidation([])}
    >
      <h2>{t(reset ? 'emailRecovery' : 'verifyEmailTitle')}</h2>
      <p>{t('localMessagesHelp')}</p>
      <ValidationErrors issues={validation} />
      {!reset && status !== 'authenticated' && (
        <p>
          <Link href="/login">{t('login')}</Link>
        </p>
      )}
      <form onSubmit={(e) => void submit(e, true)}>
        <label className="form-label">
          {t('email')}
          <Input type="email" name="email" required maxLength={254} autoComplete="email" />
        </label>
        <Button disabled={busy}>{t('requestMessage')}</Button>
      </form>
      <form onSubmit={(e) => void submit(e, false)}>
        {reset && (
          <label className="form-label">
            {t('email')}
            <Input type="email" name="email" required maxLength={254} autoComplete="email" />
          </label>
        )}
        <label className="form-label">
          {t('verificationToken')}
          <Input name="token" required maxLength={128} autoComplete="one-time-code" />
        </label>
        {reset && (
          <label className="form-label">
            {t('password')}
            <Input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
            />
            <small>{t('passwordHelp')}</small>
          </label>
        )}
        <Button disabled={busy || (!reset && status !== 'authenticated')}>
          {t(reset ? 'resetPassword' : 'verifyEmailTitle')}
        </Button>
      </form>
      {result && (
        <p className="notice" role="status">
          {t(result)}
        </p>
      )}
    </section>
  );
}
