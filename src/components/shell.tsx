'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { ArrowUpRight, Globe2, Menu, Plus, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { useLocale, type Locale } from './providers';
import { Button } from './ui/button';
import { LocalTestBanner } from './local-test-banner';
import { LegalBanner } from './legal-pages';
export function Shell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useLocale();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const { status } = useSession();
  const links = [
    ['/', t('discover')],
    ['/dashboard', t('garage')],
    ['/help', t('help')],
    ...(status === 'authenticated' ? [['/security', t('accountSecurity')]] : []),
  ];
  return (
    <>
      <a href="#main" className="skip-link">
        {t('skip')}
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Link href="/" className="brand" aria-label="AutoVeri.ch">
            <span className="brand-mark">
              A<span />
            </span>
            AutoVeri<span className="brand-ch">.ch</span>
          </Link>
          <nav className="desktop-nav" aria-label={t('menu')}>
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={path === href ? 'active' : ''}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <label className="language">
              <Globe2 size={16} />
              <span className="sr-only">{t('language')}</span>
              <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                {(['de', 'fr', 'it', 'en'] as const).map((l) => (
                  <option value={l} key={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            {status === 'authenticated' ? (
              <Button
                variant="ghost"
                className="desktop-login"
                onClick={() => void signOut({ callbackUrl: '/' })}
              >
                {t('logout')}
              </Button>
            ) : (
              <Button variant="ghost" className="desktop-login" asChild>
                <Link href="/login">{t('login')}</Link>
              </Button>
            )}
            <Button asChild className="header-sell">
              <Link href="/sell">
                <Plus size={16} />
                {t('sell')}
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu"
              aria-label={t('menu')}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        {open && (
          <nav className="mobile-nav">
            {[
              ...links,
              ['/sell', t('sell')],
              ...(status === 'authenticated' ? [] : [['/login', t('login')]]),
            ].map(([href, label]) => (
              <Link key={href} href={href} onClick={() => setOpen(false)}>
                {label}
              </Link>
            ))}
            {status === 'authenticated' && (
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  void signOut({ callbackUrl: '/' });
                }}
              >
                {t('logout')}
              </Button>
            )}
          </nav>
        )}
      </header>
      <LocalTestBanner />
      <LegalBanner />
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="container">
          <div className="footer-top">
            <div>
              <Link href="/" className="brand">
                AutoVeri<span className="brand-ch">.ch</span>
              </Link>
              <p>{t('footerText')}</p>
            </div>
            <div className="footer-links">
              <Link href="/privacy">{t('privacyTitle')}</Link>
              <Link href="/terms">{t('termsTitle')}</Link>
              <Link href="/contact">{t('contactTitle')}</Link>
              <Link href="/help">
                {t('help')}
                <ArrowUpRight size={14} />
              </Link>
              <Link href="/photo-credits">
                {t('photoCredits')}
                <ArrowUpRight size={14} />
              </Link>
              <Link href="/">
                {t('discover')}
                <ArrowUpRight size={14} />
              </Link>
              <Link href="/sell">
                {t('sell')}
                <ArrowUpRight size={14} />
              </Link>
              <Link href="/dashboard">
                {t('garage')}
                <ArrowUpRight size={14} />
              </Link>
              <Link href="/admin">
                {t('admin')}
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} AutoVeri.ch</span>
            <span>
              <ShieldCheck size={15} />
              {t('footerNote')}
            </span>
            <span className="swiss-flag">✚</span>
          </div>
        </div>
      </footer>
    </>
  );
}
