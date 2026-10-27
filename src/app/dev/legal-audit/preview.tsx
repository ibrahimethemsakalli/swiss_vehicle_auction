'use client';
import { useState } from 'react';
import { useLocale } from '../../../components/providers';
import { LegalChecks, emptyLegalChecks } from '../../../components/legal-pages';
export function LegalAudit() {
  const { locale, t } = useLocale();
  const [value, setValue] = useState({ ...emptyLegalChecks });
  return (
    <div className="login-page">
      <section className="login-card panel">
        <p>DISPLAY TEST ONLY — no submission, no legal agreement or acceptance record.</p>
        <LegalChecks
          summary={{
            releaseId: '11111111-1111-4111-8111-111111111111',
            version: 'DISPLAY-ONLY',
            draft: false,
            localDraft: false,
            locale,
            acknowledgements: {
              termsAccepted: t('legalAcceptTerms'),
              privacyAcknowledged: t('legalAcknowledgePrivacy'),
              eligibilityDeclared: t('legalEligibility'),
            },
          }}
          value={value}
          onChange={setValue}
        />
        <p className="notice">{t('bidConsent')}</p>
        <p className="notice">{t('holdExplanation')}</p>
      </section>
    </div>
  );
}
