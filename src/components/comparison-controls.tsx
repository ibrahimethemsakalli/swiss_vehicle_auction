'use client';
import Link from 'next/link';
import { useComparison } from './comparison-provider';
import { useLocale } from './providers';
import { Button } from './ui/button';
export function CompareButton({ id, name }: { id: string; name: string }) {
  const { ids, ready, toggle } = useComparison();
  const { t } = useLocale();
  const selected = ids.includes(id),
    full = ids.length >= 3 && !selected;
  return (
    <Button
      className="compare-select"
      variant="outline"
      disabled={!ready || full}
      aria-pressed={selected}
      aria-label={`${t(selected ? 'compareRemove' : 'compareAdd')}: ${name}`}
      onClick={() => toggle(id)}
    >
      {t(selected ? 'compareSelected' : full ? 'compareLimit' : 'compareAdd')}
    </Button>
  );
}
export function ComparisonTray() {
  const { ids, clear, storageFailed } = useComparison();
  const { t } = useLocale();
  if (!ids.length && !storageFailed) return null;
  return (
    <aside className="container comparison-tray" aria-label={t('compareTitle')}>
      <Link href="/compare">{t('compareOpen', { count: ids.length })}</Link>
      {!!ids.length && (
        <Button variant="ghost" onClick={clear}>
          {t('compareClear')}
        </Button>
      )}
      {ids.length === 3 && <p role="status">{t('compareLimit')}</p>}
      {storageFailed && <p role="status">{t('compareStorageFailed')}</p>}
    </aside>
  );
}
