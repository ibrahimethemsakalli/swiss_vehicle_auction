'use client';
import Link from 'next/link';
import { useLocale } from '../components/providers';
import { Button } from '../components/ui/button';
export default function NotFound() {
  const { t } = useLocale();
  return (
    <div className="empty-state">
      <h1>404</h1>
      <p>{t('notFound')}</p>
      <Button asChild>
        <Link href="/">{t('backListings')}</Link>
      </Button>
    </div>
  );
}
