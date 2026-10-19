'use client';
import Link from 'next/link';
import galleries from '../data/sample-photos.json';
import { useLocale } from './providers';
export function PhotoCredit({ src }: { src: string }) {
  const { t } = useLocale();
  const photo = galleries.flatMap((g) => g.photos).find((p) => p.src === src);
  if (!photo) return null;
  return (
    <p className="photo-credit">
      {t('photoCredit')}: {photo.author} / Wikimedia Commons ·{' '}
      <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
        {t('photoSource')}
      </a>{' '}
      ·{' '}
      <a href={photo.licenseUrl} target="_blank" rel="noreferrer">
        {photo.license}
      </a>{' '}
      · <Link href="/photo-credits">{t('photoCredits')}</Link>
    </p>
  );
}
export function PhotoCreditsPage() {
  const { t } = useLocale();
  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold mb-4">{t('photoCredits')}</h1>
      <p className="notice">{t('representativePhotos')}</p>
      <p className="my-4">{t('photoChanges')}</p>
      {galleries.map((g) => (
        <section className="panel" key={g.index}>
          <h2>{g.vehicle}</h2>
          <ul className="space-y-4">
            {g.photos.map((p) => (
              <li key={p.src}>
                <a className="underline" href={p.sourceUrl} target="_blank" rel="noreferrer">
                  {p.title}
                </a>
                <br />
                {p.attribution} ·{' '}
                <a className="underline" href={p.licenseUrl} target="_blank" rel="noreferrer">
                  {p.license}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
