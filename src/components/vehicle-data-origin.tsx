'use client';
import Link from 'next/link';
import type { VehicleView } from '../lib/market-types';
import { vehicleDataOrigin, correctionFieldLabels } from '../lib/vehicle-data-origin';
import { useLocale } from './providers';

export function VehicleDataOrigin({ vehicle }: { vehicle: VehicleView }) {
  const { t, date } = useLocale();
  const origin = vehicleDataOrigin(vehicle);
  const source =
    origin.source === 'SELLER_DECLARATION'
      ? 'dataOriginSeller'
      : origin.source === 'SAMPLE_REFERENCE'
        ? 'dataOriginSample'
        : 'dataOriginUnknown';
  return (
    <section className="panel min-w-0" aria-label={t('dataOriginTitle')}>
      <h2 className="break-words">{t('dataOriginTitle')}</h2>
      <dl className="spec-grid">
        <div>
          <dt>{t('dataOriginSource')}</dt>
          <dd>{t(source)}</dd>
        </div>
        <div>
          <dt>{t('dataOriginDate')}</dt>
          <dd>{origin.recordedAt ? date(origin.recordedAt) : t('notProvided')}</dd>
        </div>
        <div>
          <dt>{t('dataOriginVerification')}</dt>
          <dd>{t('dataOriginUnverified')}</dd>
        </div>
      </dl>
      <p className="fine-print">
        {t(origin.source === 'SAMPLE_REFERENCE' ? 'dataOriginSampleNote' : 'dataOriginNote')}
      </p>
      {vehicle.dataCorrectedAt && (
        <p className="my-3 break-words">
          {t('dataOriginCorrectionDate', { date: date(vehicle.dataCorrectedAt) })}{' '}
          {Array.from(
            new Set(
              (vehicle.dataCorrectedFields ?? [])
                .filter((k) => Object.hasOwn(correctionFieldLabels, k))
                .map((k) => t(correctionFieldLabels[k as keyof typeof correctionFieldLabels])),
            ),
          ).join(', ')}
        </p>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer break-words">{t('dataOriginLimits')}</summary>
        <p className="my-3">{t('dataOriginCatalog')}</p>
        <p className="my-3">{t('dataOriginValue')}</p>
        <p className="my-3">{t('dataOriginCorrection')}</p>
        <Link className="underline" href="/drafts">
          {t('dataOriginEdit')}
        </Link>
      </details>
    </section>
  );
}
