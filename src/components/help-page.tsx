'use client';
import Link from 'next/link';
import { useLocale } from './providers';

const topics = [
  'Verification',
  'Auction',
  'Hold',
  'Release',
  'Settlement',
  'Dispute',
  'Samples',
] as const;

export function HelpPage() {
  const { t } = useLocale();
  return (
    <div className="container help-page">
      <p className="eyebrow">AUTOVERI</p>
      <h1>{t('helpTitle')}</h1>
      <p className="help-intro">{t('helpIntro')}</p>
      <p className="notice">{t('helpScope')}</p>
      <nav className="help-topics" aria-label={t('helpTopics')}>
        {topics.map((topic) => (
          <a key={topic} href={`#help-${topic.toLowerCase()}`}>
            {t(`help${topic}Title`)}
          </a>
        ))}
      </nav>
      {topics.map((topic) => (
        <section className="panel" key={topic} id={`help-${topic.toLowerCase()}`}>
          <h2>{t(`help${topic}Title`)}</h2>
          <p>{t(`help${topic}Text`)}</p>
        </section>
      ))}
      <p className="fine-print">{t('helpNotTerms')}</p>
      <Link className="help-return" href="/">
        {t('discover')}
      </Link>
    </div>
  );
}
