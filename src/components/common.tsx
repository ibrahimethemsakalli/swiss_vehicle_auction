'use client';
import { useEffect, useState } from 'react';
import { CarFront, ShieldCheck, Building2, Clock3, RefreshCw } from 'lucide-react';
import { useLocale, type MessageKey } from './providers';
import type { VehicleView } from '../lib/market-types';
import { isMfkFresh } from '../lib/market-types';
import { Button } from './ui/button';
export function useResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(0);
    setData(null);
    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<T>;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(Number(e.message) || 503);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision]);
  return { data, error, loading, reload: () => setRevision((n) => n + 1) };
}
export function DemoBanner() {
  const { t } = useLocale();
  return <div className="demo-banner">{t('demo')}</div>;
}
export function Loading() {
  const { t } = useLocale();
  return (
    <div className="empty-state" role="status">
      <RefreshCw className="animate-spin" size={24} />
      <p>{t('loading')}</p>
    </div>
  );
}
export function ErrorState({ retry, code }: { retry?: () => void; code?: number }) {
  const { t } = useLocale();
  return (
    <div className="empty-state" role="alert">
      <CarFront size={32} />
      <h2>{t(code === 404 ? 'notFound' : code === 403 ? 'accessDenied' : 'error')}</h2>
      {retry && (
        <Button variant="outline" onClick={retry}>
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
export function EmptyState() {
  const { t } = useLocale();
  return (
    <div className="empty-state">
      <CarFront size={32} />
      <h3>{t('noActivity')}</h3>
      <p>{t('noActivityText')}</p>
    </div>
  );
}
export function SellerBadge({ vehicle }: { vehicle: VehicleView }) {
  const { t } = useLocale();
  if (vehicle.isSample)
    return (
      <span className="seller-badge dealer">
        <CarFront size={13} /> {t('sampleListing')}
      </span>
    );
  return (
    <span
      className={`seller-badge ${vehicle.sellerType === 'DEALER' ? 'dealer' : vehicle.verified ? 'verified' : ''}`}
    >
      {vehicle.sellerType === 'DEALER' ? <Building2 size={13} /> : <ShieldCheck size={13} />}{' '}
      {t(
        vehicle.sellerType === 'DEALER'
          ? 'dealer'
          : vehicle.verified
            ? 'private'
            : 'privateUnverified',
      )}
    </span>
  );
}
export function MfkBadge({ date }: { date: string }) {
  const { t } = useLocale();
  return isMfkFresh(date) ? (
    <span className="mfk-badge">
      <ShieldCheck size={12} />
      {t('fresh')}
    </span>
  ) : null;
}
export function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  return (
    <span
      className={`status-badge ${['ACTIVE', 'AUTHORIZED', 'WON', 'SOLD', 'RELEASED'].includes(status) ? 'positive' : ''}`}
    >
      {t(status as MessageKey)}
    </span>
  );
}
export function Countdown({ end, large = false }: { end: string | null; large?: boolean }) {
  const { t } = useLocale();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = end && now ? Math.max(0, Math.floor((Date.parse(end) - now) / 1000)) : null;
  const days = seconds === null ? 0 : Math.floor(seconds / 86400);
  const time =
    seconds === null
      ? '—'
      : seconds === 0
        ? t('ended')
        : `${days ? `${days}${t('days')} ` : ''}${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <span
      className={`countdown ${large ? 'large' : ''} ${seconds !== null && seconds < 10800 ? 'urgent' : ''}`}
      aria-label={`${t('remaining')}: ${time}`}
    >
      <Clock3 size={large ? 20 : 13} />
      {time}
    </span>
  );
}
export function VehicleImage({
  src,
  alt,
  ...props
}: { src?: string; alt: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  const { t } = useLocale();
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? (
    <img {...props} src={src} alt={alt} onError={() => setFailed(true)} />
  ) : (
    <div className="photo-fallback">
      <CarFront size={52} />
      <span>{t('noPhoto')}</span>
    </div>
  );
}
