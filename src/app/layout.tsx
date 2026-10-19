import './globals.css';
import { Providers } from '../components/providers';
import { Shell } from '../components/shell';
export const metadata = { title: 'AutoVeri.ch', description: 'Verified Swiss vehicle auctions' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
