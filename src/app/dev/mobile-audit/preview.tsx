'use client';
import { useLocale, type MessageKey } from '../../../components/providers';
import en from '../../../messages/en.json';

// Development-only visual fixtures. No submission or payment actions.
export function MobileAudit() {
  const { t } = useLocale();
  return (
    <div className="container dashboard-page">
      <h1>Form message fixtures</h1>
      <section className="login-card panel" style={{ margin: '16px 0', width: '100%' }}>
        {Object.keys(en)
          .filter((k) => /Failed$|Required$|invalidPhoto|^error$/.test(k))
          .map((key) => (
            <p className="notice" role="alert" key={key} data-message-key={key}>
              {t(key as MessageKey)}
            </p>
          ))}
      </section>
      <section className="panel management-record">
        {[
          'REFUND_REQUIRED',
          'MANUAL_RESOLUTION',
          'AWAITING_SELLER_CONFIRMATION',
          'decisionConsent',
          'listingConsent',
          'bindingBid',
        ]
          .filter((k) => k in en)
          .map((key) => (
            <p key={key}>{t(key as MessageKey)}</p>
          ))}
      </section>
    </div>
  );
}
