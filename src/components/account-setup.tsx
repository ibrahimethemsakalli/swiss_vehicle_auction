'use client';
import Link from 'next/link';
import { useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLocale } from './providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useResource, Loading, ErrorState } from './common';
export function Registration() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [dealer, setDealer] = useState(false);
  return (
    <div className="login-page">
      <section className="login-card panel">
        <h1>{t('register')}</h1>
        <p>{t('registerHelp')}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError(false);
            try {
              const payload = {
                email: form.get('email'),
                password: form.get('password'),
                phone: form.get('phone'),
                role: dealer ? 'DEALER' : 'PRIVATE_USER',
                language: locale,
                ...(dealer
                  ? {
                      companyName: form.get('companyName'),
                      handelsregisterNr: form.get('handelsregisterNr'),
                    }
                  : {}),
              };
              const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error();
              const result = await signIn('credentials', {
                email: payload.email,
                password: payload.password,
                redirect: false,
              });
              router.push(result?.ok ? '/verify' : '/login');
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="form-label">
            {t('email')}
            <Input
              name="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label className="form-label">
            {t('password')}
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              required
            />
            <small>{t('passwordHelp')}</small>
          </label>
          <label className="form-label">
            {t('phone')}
            <Input
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+41791234567"
              pattern="\+41[1-9][0-9]{8}"
              required
            />
          </label>
          <label className="check-label">
            <input type="checkbox" checked={dealer} onChange={(e) => setDealer(e.target.checked)} />
            {t('dealer')}
          </label>
          {dealer && (
            <>
              <label className="form-label">
                {t('companyName')}
                <Input name="companyName" required maxLength={160} />
              </label>
              <label className="form-label">
                {t('companyRegister')}
                <Input name="handelsregisterNr" required maxLength={80} />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="notice">
              {t('registrationFailed')}
            </p>
          )}
          <Button className="w-full mt-4" variant="green" disabled={busy}>
            {t(busy ? 'loading' : 'register')}
          </Button>
        </form>
        <Link href="/login">{t('login')}</Link>
      </section>
    </div>
  );
}
export function Verification() {
  const { t } = useLocale();
  const { status } = useSession();
  const resource = useResource<{
    phone: string;
    phoneVerified: boolean;
    identityVerified: boolean;
  }>('/api/verification');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'smsSent' | 'verificationFailed' | null>(null);
  const [code, setCode] = useState('');
  async function action(action: 'send' | 'check') {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch('/api/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(action === 'check' ? { code } : {}) }),
      });
      if (!r.ok) throw new Error();
      if (action === 'send') setMessage('smsSent');
      else resource.reload();
    } catch {
      setMessage('verificationFailed');
    } finally {
      setBusy(false);
    }
  }
  if (status === 'unauthenticated')
    return (
      <div className="login-page">
        <Link href="/login">{t('login')}</Link>
      </div>
    );
  if (resource.loading) return <Loading />;
  if (!resource.data) return <ErrorState retry={resource.reload} />;
  return (
    <div className="login-page">
      <section className="login-card panel">
        <h1>{t('verifyAccount')}</h1>
        <p>{resource.data.phone}</p>
        {resource.data.phoneVerified ? (
          <p className="notice success">{t('phoneVerified')}</p>
        ) : (
          <>
            <Button variant="outline" disabled={busy} onClick={() => void action('send')}>
              {t('sendCode')}
            </Button>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void action('check');
              }}
            >
              <label className="form-label">
                {t('smsCode')}
                <Input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{4,10}"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <Button disabled={busy}>{t('verifyCode')}</Button>
            </form>
          </>
        )}
        {message && (
          <p className="notice" role="status">
            {t(message)}
          </p>
        )}
        <p className="notice mt-4">
          {t(resource.data.identityVerified ? 'identityApproved' : 'identityPending')}
        </p>
        <Link href="/dashboard">{t('garage')}</Link>
      </section>
    </div>
  );
}
