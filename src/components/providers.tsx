'use client';
import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { SessionProvider } from 'next-auth/react';
import { createInstance } from 'i18next';
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
export function Providers({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>('de');
  useEffect(() => {
    try {
      const stored = localStorage.getItem('autoveri-language');
      if (stored && stored in resources) setLocale(stored as Locale);
    } catch {}
  }, []);
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
  }, [locale]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <SessionProvider>
      <Context.Provider value={value}>{children}</Context.Provider>
    </SessionProvider>
  );
}
export const useLocale = () => useContext(Context);
