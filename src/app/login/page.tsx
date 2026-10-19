'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { useLocale } from '../../components/providers';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
export default function Login() {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className="login-page">
      <div className="login-card panel">
        <ShieldCheck size={38} />
        <h1>{t('loginTitle')}</h1>
        <p>{t('loginText')}</p>
        <form
          method="post"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError(false);
            try {
              const result = await signIn('credentials', {
                email: form.get('email'),
                password: form.get('password'),
                redirect: false,
              });
              if (result?.ok) {
                const next = new URLSearchParams(window.location.search).get('next');
                router.push(next === '/sell' ? '/sell' : '/dashboard');
                router.refresh();
              } else setError(true);
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
            />
          </label>
          <label className="form-label">
            {t('password')}
            <Input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && (
            <p className="notice" role="alert">
              {t('loginFailed')}
            </p>
          )}
          <Button type="submit" variant="green" className="w-full" disabled={busy || !ready}>
            {busy ? t('loading') : t('login')}
            <ArrowRight size={16} />
          </Button>
        </form>
        <p className="fine-print">
          <Link href="/reset-password">{t('resetPassword')}</Link>
        </p>
        <p className="fine-print">
          <Link href="/register">{t('register')}</Link> ·{' '}
          <Link href="/verify">{t('verifyAccount')}</Link>
        </p>
      </div>
    </div>
  );
}
