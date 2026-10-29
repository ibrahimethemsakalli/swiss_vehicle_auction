import './globals.css';
import { Providers } from '../components/providers';
import { Shell } from '../components/shell';
import { headers } from 'next/headers';
import { seoLocale } from '../lib/seo';
import { PwaProvider } from '../components/pwa';
import { pwaEnabled } from '../lib/pwa';
export const viewport = { themeColor: '#0F172A' };
export const metadata = {
  title: 'AutoVeri.ch',
  robots: { index: false, follow: false },
  icons: { apple: '/pwa/icon-192.png' },
};
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = seoLocale((await headers()).get('x-autoveri-locale'));
  return (
    <html lang={locale}>
      <body>
        <Providers initialLocale={locale}>
          <PwaProvider enabled={pwaEnabled()}>
            <Shell>{children}</Shell>
          </PwaProvider>
        </Providers>
      </body>
    </html>
  );
}
