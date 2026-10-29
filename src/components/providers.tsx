'use client';
import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { ComparisonProvider } from './comparison-provider';
import { SessionProvider } from 'next-auth/react';
import { createInstance } from 'i18next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { publicSeoPath, seoLocale } from '../lib/seo';
import de from '../messages/de.json';
import fr from '../messages/fr.json';
import it from '../messages/it.json';
import en from '../messages/en.json';
export type Locale = 'de' | 'fr' | 'it' | 'en';
export type MessageKey = keyof typeof de;
const resources = {
  de: { translation: de },
  fr: { translation: fr },
  it: { translation: it },
  en: { translation: en },
};
const Context = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  money: (n: number) => string;
  number: (n: number) => string;
  date: (s: string) => string;
}>(null!);
export function Providers({
  children,
  initialLocale = 'de',
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const pathname = usePathname(),
    query = useSearchParams(),
    router = useRouter();
  const languages = query.getAll('lang');
  const urlLocale = seoLocale(languages.length === 1 ? languages[0] : undefined);
  const publicPage = publicSeoPath(pathname);
  useEffect(() => {
    if (publicPage) {
      setLocale(urlLocale);
      return;
    }
    try {
      const stored = localStorage.getItem('autoveri-language');
      if (stored && stored in resources) setLocale(stored as Locale);
    } catch {}
  }, [publicPage, urlLocale]);
  const value = useMemo(() => {
    const instance = createInstance();
    void instance.init({
      resources,
      lng: locale,
      fallbackLng: 'de',
      initImmediate: false,
      interpolation: { escapeValue: false },
    });
    return {
      locale,
      setLocale: (language: Locale) => {
        setLocale(language);
        if (publicPage) {
          const url = new URL(window.location.href);
          url.searchParams.set('lang', language);
          router.replace(url.pathname + url.search + url.hash, { scroll: false });
        }
        try {
          localStorage.setItem('autoveri-language', language);
        } catch {}
      },
      t: (key: MessageKey, values?: Record<string, string | number>) =>
        String(instance.t(key, values)),
      money: (n: number) =>
        new Intl.NumberFormat(`${locale}-CH`, {
          style: 'currency',
          currency: 'CHF',
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(n),
      number: (n: number) => new Intl.NumberFormat(`${locale}-CH`).format(n),
      date: (s: string) =>
        new Intl.DateTimeFormat(`${locale}-CH`, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'Europe/Zurich',
        }).format(new Date(s)),
    };
  }, [locale, publicPage, router]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <SessionProvider>
      <Context.Provider value={value}>
        <ComparisonProvider>{children}</ComparisonProvider>
      </Context.Provider>
    </SessionProvider>
  );
}
export const useLocale = () => useContext(Context);
