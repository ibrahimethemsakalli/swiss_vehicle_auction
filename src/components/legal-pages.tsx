'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useLocale, type Locale } from './providers';
import { useResource, Loading, ErrorState } from './common';
import { Button } from './ui/button';
// Import types only: hashing and database modules stay on the server.
import type { LegalContent, LegalKind } from '../lib/legal-policy';

const fields = [
  'legalName',
  'legalForm',
  'address',
  'country',
  'registryId',
  'domain',
  'supportEmail',
  'privacyEmail',
  'phone',
  'hostingAndCountry',
  'databaseAndCountry',
  'storageAndCountry',
  'paymentProviderAndCountry',
  'smsProviderAndCountry',
  'emailProviderAndCountry',
  'analyticsPolicy',
  'retentionPolicy',
  'supportAndRefundPolicy',
] as const;
type PublicDoc = {
  id: string | null;
  version: string;
  draft: boolean;
  locale: Locale;
  content: LegalContent;
  contentHash: string | null;
  publishedAt: string | null;
};
export type LegalSummary = {
  releaseId: string | null;
  version: string | null;
  draft: boolean;
  localDraft: boolean;
  locale: Locale;
  acknowledgements: LegalContent['acknowledgements'] | null;
};
const link = (kind: 'privacy' | 'terms', version: string | null, locale: string) =>
  `/${kind}?${new URLSearchParams({ ...(version ? { version } : {}), lang: locale })}`;

export function LegalPage({
  kind,
  contact = false,
  version,
  language,
}: {
  kind: LegalKind;
  contact?: boolean;
  version?: string;
  language?: string;
}) {
  const { locale, setLocale, t, date } = useLocale();
  useEffect(() => {
    if (language && ['de', 'fr', 'it', 'en'].includes(language)) setLocale(language as Locale);
  }, [language]);
  const r = useResource<PublicDoc>(
    `/api/legal/documents?${new URLSearchParams({ kind, lang: locale, ...(version ? { version } : {}) })}`,
  );
  if (r.loading) return <Loading />;
  if (!r.data) return <ErrorState retry={r.reload} code={r.error} />;
  const doc = r.data;
  return (
    <div className="container legal-page">
      <p className="eyebrow">AUTOVERI · {doc.draft ? t('legalDraft') : doc.version}</p>
      <h1>{contact ? t('contactTitle') : doc.content.title}</h1>
      {doc.draft && (
        <p className="notice" role="status">
          {t('legalDraftNotice')}
        </p>
      )}
      {!doc.draft && (
        <p className="fine-print">
          {t('legalVersion')}: {doc.version} · {t('legalPublished')}: {date(doc.publishedAt!)}
        </p>
      )}
      <nav className="legal-links" aria-label={t('legalDocuments')}>
        <Link href={link('privacy', doc.draft ? null : doc.version, locale)}>
          {t('privacyTitle')}
        </Link>
        <Link href={link('terms', doc.draft ? null : doc.version, locale)}>{t('termsTitle')}</Link>
        <Link href="/contact">{t('contactTitle')}</Link>
        <Link href="/legal/accept">{t('legalAccountTitle')}</Link>
      </nav>
      {contact && <p>{t('contactDraftHelp')}</p>}
      {!contact &&
        doc.content.sections.map(([heading, body], i) => (
          <section className="panel" key={i}>
            <h2>{heading}</h2>
            <p>{body}</p>
          </section>
        ))}
      {!contact && (
        <section className="panel">
          <h2>{t('legalStatements')}</h2>
          <ul className="space-y-3">
            {Object.values(doc.content.acknowledgements).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel">
        <h2>{t('legalOperatorDetails')}</h2>
        <dl className="legal-details">
          {fields
            .filter(
              (field) =>
                !contact ||
                [
                  'legalName',
                  'legalForm',
                  'address',
                  'country',
                  'registryId',
                  'domain',
                  'supportEmail',
                  'privacyEmail',
                  'phone',
                ].includes(field),
            )
            .map((field) => (
              <div key={field}>
                <dt>{t(`legalField_${field}`)}</dt>
                <dd>{doc.content.operator[field] ?? t('legalNotSet')}</dd>
              </div>
            ))}
        </dl>
      </section>
      {doc.contentHash && <p className="legal-hash">SHA-256: {doc.contentHash}</p>}
    </div>
  );
}

export type LegalCheckState = {
  termsAccepted: boolean;
  privacyAcknowledged: boolean;
  eligibilityDeclared: boolean;
};
export const emptyLegalChecks: LegalCheckState = {
  termsAccepted: false,
  privacyAcknowledged: false,
  eligibilityDeclared: false,
};
export function LegalChecks({
  summary,
  value,
  onChange,
}: {
  summary: LegalSummary;
  value: LegalCheckState;
  onChange: (next: LegalCheckState) => void;
}) {
  const { locale, t } = useLocale();
  useEffect(() => {
    onChange({ ...emptyLegalChecks });
  }, [locale, summary.releaseId]);
  if (summary.draft)
    return (
      <p className="notice">{t(summary.localDraft ? 'legalLocalDraft' : 'legalNotAvailable')}</p>
    );
  if (summary.locale !== locale || !summary.acknowledgements)
    return <p className="notice">{t('loading')}</p>;
  return (
    <fieldset className="legal-checks">
      <legend>
        {t('legalDocuments')} · {summary.version}
      </legend>
      <p className="legal-links">
        <Link target="_blank" href={link('terms', summary.version, locale)}>
          {t('termsTitle')}
        </Link>
        <Link target="_blank" href={link('privacy', summary.version, locale)}>
          {t('privacyTitle')}
        </Link>
      </p>
      {(['termsAccepted', 'privacyAcknowledged', 'eligibilityDeclared'] as const).map((key) => (
        <label className="check-label" key={key}>
          <input
            type="checkbox"
            required
            checked={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          {summary.acknowledgements![key]}
        </label>
      ))}
    </fieldset>
  );
}

type Receipts = {
  current: LegalSummary;
  receipts: {
    id: string;
    releaseId: string;
    version: string;
    locale: Locale;
    acceptedAt: string;
    termsHash: string;
    privacyHash: string;
  }[];
};
export function LegalAccount() {
  const { status } = useSession();
  const { t } = useLocale();
  if (status === 'loading') return <Loading />;
  if (status !== 'authenticated')
    return (
      <div className="container legal-page">
        <h1>{t('legalAccountTitle')}</h1>
        <Link href="/login">{t('signInRequired')}</Link>
      </div>
    );
  return <LegalAccountContent />;
}
function LegalAccountContent() {
  const { locale, t, date } = useLocale();
  const r = useResource<Receipts>(`/api/legal/acceptances?lang=${locale}`);
  const [checks, setChecks] = useState({ ...emptyLegalChecks });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (r.loading) return <Loading />;
  if (!r.data) return <ErrorState retry={r.reload} />;
  const current = r.data.current;
  const accepted = r.data.receipts.some((receipt) => receipt.releaseId === current.releaseId);
  return (
    <div className="container legal-page">
      <h1>{t('legalAccountTitle')}</h1>
      <p>{t('legalHistoryHelp')}</p>
      {accepted ? (
        <p role="status" className="notice">
          {t('legalAlreadyAccepted')}
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(false);
            try {
              const response = await fetch('/api/legal/acceptances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ releaseId: current.releaseId, locale, ...checks }),
              });
              if (!response.ok) throw Error();
              r.reload();
              window.dispatchEvent(new Event('legal:accepted'));
            } catch {
              setError(true);
              r.reload();
            } finally {
              setBusy(false);
            }
          }}
        >
          <LegalChecks summary={current} value={checks} onChange={setChecks} />
          {!current.draft && (
            <Button
              className="mt-4"
              disabled={
                busy ||
                current.locale !== locale ||
                !current.acknowledgements ||
                !Object.values(checks).every(Boolean)
              }
            >
              {t('legalSaveAcceptance')}
            </Button>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="notice">
          {t('legalAcceptanceFailed')}
        </p>
      )}
      <h2>{t('legalHistory')}</h2>
      {!r.data.receipts.length && <p>{t('legalNoHistory')}</p>}
      {r.data.receipts.map((receipt) => (
        <article className="panel" key={receipt.id}>
          <h3>
            {receipt.version} · {receipt.locale.toUpperCase()}
          </h3>
          <p>
            {new Intl.DateTimeFormat(`${locale}-CH`, {
              dateStyle: 'medium',
              timeStyle: 'long',
              timeZone: 'Europe/Zurich',
            }).format(new Date(receipt.acceptedAt))}
          </p>
          <p className="legal-links">
            <Link href={link('terms', receipt.version, receipt.locale)}>{t('termsTitle')}</Link>
            <Link href={link('privacy', receipt.version, receipt.locale)}>{t('privacyTitle')}</Link>
          </p>
          <p className="legal-hash">
            {t('termsTitle')} SHA-256: {receipt.termsHash}
          </p>
          <p className="legal-hash">
            {t('privacyTitle')} SHA-256: {receipt.privacyHash}
          </p>
        </article>
      ))}
    </div>
  );
}
export function LegalBanner() {
  const { status } = useSession();
  return status === 'authenticated' ? <LegalBannerContent /> : null;
}
function LegalBannerContent() {
  const { t, locale } = useLocale();
  const r = useResource<Receipts>(`/api/legal/acceptances?lang=${locale}`);
  useEffect(() => {
    const listener = () => r.reload();
    window.addEventListener('legal:accepted', listener);
    return () => window.removeEventListener('legal:accepted', listener);
  }, [r.reload]);
  if (
    !r.data ||
    r.data.current.draft ||
    r.data.receipts.some((receipt) => receipt.releaseId === r.data!.current.releaseId)
  )
    return null;
  return (
    <div className="container legal-banner" role="status">
      <p>{t('legalRenewalRequired')}</p>
      <Link href="/legal/accept">{t('legalAccountTitle')}</Link>
    </div>
  );
}
