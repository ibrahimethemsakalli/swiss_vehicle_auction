'use client';
import { useState } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { useLocale } from './providers';
import { Input } from './ui/input';
import { Button } from './ui/button';
export function Security({ reset = false }: { reset?: boolean }) {
  const { t } = useLocale();
  const { status } = useSession();
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'securitySuccess' | 'securityFailed' | null>(null);
  if (!reset && status === 'unauthenticated')
    return (
      <div className="login-page">
        <Link href="/login">{t('login')}</Link>
      </div>
    );
  async function submit(e: React.FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(true);
    setResult(null);
    setCodes([]);
    try {
      const response = await fetch('/api/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...values }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (data.codes) {
        setCodes(data.codes);
        form.reset();
      } else {
        setResult('securitySuccess');
        form.reset();
        if (!reset) await signOut({ callbackUrl: '/login' });
      }
    } catch {
      setResult('securityFailed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-card panel">
        <h1>{t(reset ? 'resetPassword' : 'accountSecurity')}</h1>
        <p>{t('recoveryHelp')}</p>
        <form onSubmit={(e) => void submit(e, reset ? 'reset' : 'change')}>
          {reset ? (
            <>
              <label className="form-label">
                {t('email')}
                <Input name="email" type="email" required autoComplete="email" />
              </label>
              <label className="form-label">
                {t('recoveryCode')}
                <Input name="code" required minLength={20} maxLength={128} autoComplete="off" />
              </label>
            </>
          ) : (
            <label className="form-label">
              {t('currentPassword')}
              <Input
                name="currentPassword"
                type="password"
                required
                maxLength={72}
                autoComplete="current-password"
              />
            </label>
          )}
          <label className="form-label">
            {t('newPassword')}
            <Input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
            />
          </label>
          <Button disabled={busy} className="w-full">
            {t(reset ? 'resetPassword' : 'changePassword')}
          </Button>
        </form>
        {!reset && (
          <form className="mt-6" onSubmit={(e) => void submit(e, 'generate')}>
            <h2>{t('recoveryCodes')}</h2>
            <p>{t('recoverySave')}</p>
            <label className="form-label">
              {t('currentPassword')}
              <Input
                name="currentPassword"
                type="password"
                required
                maxLength={72}
                autoComplete="current-password"
              />
            </label>
            <Button variant="outline" disabled={busy}>
              {t('generateCodes')}
            </Button>
          </form>
        )}
        {!!codes.length && (
          <div className="notice mt-4" role="status">
            <p>{t('recoverySave')}</p>
            <pre className="overflow-x-auto select-all text-sm mt-3">{codes.join('\n')}</pre>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => {
                const blob = new Blob([codes.join('\n')], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'autoveri-recovery-codes.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              {t('downloadCodes')}
            </Button>
          </div>
        )}
        {result && (
          <p className="notice mt-4" role="status">
            {t(result)}
          </p>
        )}
        <Link href={reset ? '/login' : '/dashboard'}>{t(reset ? 'login' : 'garage')}</Link>
      </section>
    </div>
  );
}
