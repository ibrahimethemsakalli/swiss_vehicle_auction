'use client';
import Link from 'next/link';
import { SpecDetails } from './vehicle-spec-fields';
import { PhotoCredit } from './photo-credit';
import { GalleryPhoto } from './gallery-photo';
import { PaymentHold } from './payment-hold';
import { OfferForm } from './offers';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Expand,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import type { VehicleView } from '../lib/market-types';
import { vehicleYear } from '../lib/market-types';
import { sampleSource } from '../lib/sample-facts';
import { useLocale } from './providers';
import {
  Countdown,
  DemoBanner,
  ErrorState,
  Loading,
  MfkBadge,
  SellerBadge,
  StatusBadge,
  useResource,
  VehicleImage,
} from './common';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
type History = { id: string; amount: number; createdAt: string };
type Detail = { demo: boolean; vehicle: VehicleView; history: History[] };
export function VehicleDetail({ id }: { id: string }) {
  const resource = useResource<Detail>(`/api/market/${encodeURIComponent(id)}`);
  if (resource.loading) return <Loading />;
  if (resource.error || !resource.data)
    return <ErrorState code={resource.error} retry={resource.reload} />;
  return <DetailContent key={id} initial={resource.data} />;
}
function DetailContent({ initial }: { initial: Detail }) {
  const { data: localMode } = useResource<{ enabled: boolean }>('/api/local-test');
  const { t, money, number, date } = useLocale();
  const { status } = useSession();
  const [v, setVehicle] = useState(initial.vehicle);
  const [history, setHistory] = useState(initial.history);
  const [photo, setPhoto] = useState(0);
  const [gallery, setGallery] = useState(false);
  const [connection, setConnection] = useState<'live' | 'reconnecting' | 'offline'>('reconnecting');
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'bidSuccess' | 'bidFailed' | null>(null);
  const [hold, setHold] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const socket = useRef<Socket | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);
  const minimum = v.hasBids ? v.price + v.increment : v.price;
  const isAuction = v.listingType === 'AUCTION_7_DAYS';
  const biddingClosed = v.saleCancelled || v.status !== 'ACTIVE' || expired;
  useEffect(() => {
    const tick = () => setExpired(!!v.end && Date.parse(v.end) <= Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [v.end]);
  useEffect(() => {
    if (initial.demo) return;
    const s = io({ withCredentials: true });
    socket.current = s;
    const apply = (event: {
      id?: string;
      vehicleId?: string;
      amount?: string;
      currentPrice?: string | null;
      auctionEndsAt: string;
      version: number;
      status?: string;
    }) => {
      if ((event.id ?? event.vehicleId) !== v.id) return;
      setVehicle((old) =>
        event.version < old.version
          ? old
          : {
              ...old,
              price: Number(event.amount ?? event.currentPrice ?? old.price),
              hasBids: !!(event.amount ?? event.currentPrice) || old.hasBids,
              end: event.auctionEndsAt,
              version: event.version,
              status: event.status ?? old.status,
            },
      );
    };
    s.on('connect', () => {
      setConnection('live');
      s.emit('auction.subscribe', v.id);
    });
    s.on('disconnect', () => setConnection('offline'));
    s.on('connect_error', () => setConnection('offline'));
    s.on('auction.snapshot', apply);
    s.on('auction.updated', apply);
    const refresh = () => {
      fetch(`/api/market/${v.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: Detail | null) => {
          if (data) {
            setVehicle((old) => (data.vehicle.version >= old.version ? data.vehicle : old));
            setHistory(data.history);
          }
        })
        .catch(() => {});
    };
    s.on('auction.updated', refresh);
    const interval = setInterval(refresh, 15000);
    return () => {
      clearInterval(interval);
      s.disconnect();
      socket.current = null;
    };
  }, [initial.demo, v.id]);
  useEffect(() => {
    if (initial.demo || status !== 'authenticated') return;
    const controller = new AbortController();
    fetch(`/api/holds?vehicleId=${v.id}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => setHold(data.holds?.[0]?.id ?? null))
      .catch(() => {});
    return () => controller.abort();
  }, [initial.demo, status, v.id, result]);
  async function submit() {
    if (!hold || !consent || busy || biddingClosed) return;
    setBusy(true);
    setResult(null);
    const key = `${hold}:${amount}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    const payload = {
      vehicleId: v.id,
      holdId: hold,
      amount: Number(amount).toFixed(2),
      requestId: request.current.id,
    };
    try {
      if (socket.current?.connected) {
        const reply = await socket.current.timeout(10000).emitWithAck('auction.bid', payload);
        if (reply.error) throw new Error();
      } else {
        const response = await fetch('/api/bids', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error();
      }
      setResult('bidSuccess');
      setConfirm(false);
      setHold(null);
      // Refresh immediately when the HTTP fallback accepted a bid while sockets are offline.
      void fetch(`/api/market/${v.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: Detail | null) => {
          if (data) {
            setVehicle((old) => (data.vehicle.version >= old.version ? data.vehicle : old));
            setHistory(data.history);
          }
        })
        .catch(() => {});
    } catch {
      setResult('bidFailed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {initial.demo && <DemoBanner />}
      {v.isSample && <div className="demo-banner">{t('sampleReadOnly')}</div>}
      <div className="container detail-page">
        <Link href="/" className="back-link">
          <ArrowLeft size={15} />
          {t('backListings')}
        </Link>
        <div className="detail-title">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <SellerBadge vehicle={v} />
              <span className="location">
                <MapPin size={13} />
                {v.canton}, CH
              </span>
            </div>
            <h1>
              {v.make} <span>{v.model}</span>
            </h1>
            {v.saleCancelled && <p role="status">{t('saleCancelledNotice')}</p>}
            {v.status !== 'ACTIVE' && (
              <StatusBadge status={v.saleCancelled ? 'CANCELLED' : v.status} />
            )}
            <p>
              {vehicleYear(v) ?? t('unverified')} · {number(v.mileage)} km · {v.powerKw ?? '—'} kW
            </p>
          </div>
          {!v.isSample && !initial.demo && <MfkBadge date={v.mfkDate} />}
        </div>
        <a href="#vehicle-price-offers" className="mobile-price-link">
          {t('priceOffers')}
        </a>
        <div className="detail-layout">
          <div className="detail-main">
            <div className="gallery-main">
              <button
                type="button"
                className="gallery-open"
                aria-label={t('photos')}
                onClick={() => setGallery(true)}
              >
                <VehicleImage
                  src={v.images[photo]}
                  alt={`${v.make} ${v.model} — ${t('photo', { number: photo + 1 })}`}
                />
              </button>
              <button
                onClick={() => setGallery(true)}
                className="gallery-expand"
                aria-label={t('photos')}
              >
                <Expand size={17} />
                {photo + 1} / {v.images.length}
              </button>
            </div>
            <div className="thumbnails">
              {v.images.map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  aria-label={t('photo', { number: i + 1 })}
                  aria-pressed={photo === i}
                  className={photo === i ? 'selected' : ''}
                  onClick={() => setPhoto(i)}
                >
                  <VehicleImage src={src} alt={t('photo', { number: i + 1 })} />
                </button>
              ))}
            </div>
            <PhotoCredit src={v.images[photo]} />
            {(v.isSample || initial.demo) && (
              <div className="notice">
                <p>{t('representativePhotos')}</p>
                <p>
                  {t('sourceYear')}: {v.modelYear ?? t('unverified')}
                </p>
                <a
                  className="underline"
                  href={sampleSource(v.images)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('photoSource')}
                </a>
              </div>
            )}
            {initial.demo && <p className="notice">{t('demoDetails')}</p>}
            <section className="panel">
              <h2>
                <ShieldCheck size={21} />
                {t('vehicleData')}
              </h2>
              <dl className="spec-grid">
                {[
                  [
                    t('registration'),
                    v.firstRegistration ? date(v.firstRegistration) : t('unverified'),
                  ],
                  [t('mileage'), `${number(v.mileage)} km`],
                  [t('power'), v.powerKw ? `${v.powerKw} kW` : '—'],
                  [t('capacity'), v.cubicCapacity ? `${number(v.cubicCapacity)} cm³` : '—'],
                  [t('stammnummer'), v.stammnummer],
                  [t('vin'), v.maskedVin],
                  [t('inspection'), v.isSample || initial.demo ? t('unverified') : date(v.mfkDate)],
                  [
                    t('serviceHistory'),
                    v.isSample || initial.demo ? t('unverified') : t(v.serviceHistory as 'FULL'),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <SpecDetails vehicle={v} />
              <p className="fine-print">{t('inspectionNote')}</p>
            </section>
            <section className="panel">
              <h2>{t('aboutVehicle')}</h2>
              <p className="description-text">
                {v.description || t(initial.demo ? 'sampleDescription' : 'notProvided')}
              </p>
              <h3>{t('tireCondition')}</h3>
              <p>{v.tireCondition || t('notProvided')}</p>
            </section>
            <section className="panel">
              <h2>{t('history')}</h2>
              {history.length === 0 ? (
                <p>{t('emptyHistory')}</p>
              ) : (
                history.map((b) => (
                  <div key={b.id} className="history-row">
                    <span>
                      {t('anonymous')}
                      <small>{date(b.createdAt)}</small>
                    </span>
                    <strong>{money(b.amount)}</strong>
                  </div>
                ))
              )}
            </section>
          </div>
          <aside className="bid-sidebar" id="vehicle-price-offers" tabIndex={-1}>
            <div className="bid-panel">
              <div className="bid-live">
                <span>
                  <span
                    className={`connection-dot ${connection === 'live' && !initial.demo ? 'connected' : ''}`}
                  />
                  {initial.demo ? t('demoShort') : t(connection)}
                </span>
                <Wifi size={15} />
              </div>
              <p className="bid-label">
                {t(!isAuction ? 'fixedPrice' : v.hasBids ? 'currentBid' : 'startingPrice')}
              </p>
              <strong className="bid-price">{money(v.price)}</strong>
              {isAuction && (
                <div className="bid-count">
                  {v.bidCount} {t('bids')}
                </div>
              )}
              {isAuction && (
                <>
                  <div className="auction-clock">
                    <small>{t('remaining')}</small>
                    <Countdown end={v.end} large />
                  </div>
                  {biddingClosed ? (
                    <p className="notice mt-4">{t('biddingClosed')}</p>
                  ) : (
                    <>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          setConsent(false);
                          setConfirm(true);
                        }}
                      >
                        <label className="form-label">
                          {t('bidAmount')}
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={minimum}
                            max="999999999"
                            step="0.01"
                            placeholder={String(minimum)}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            required
                          />
                        </label>
                        <div className="minimum-row">
                          <span>{t('minimum')}</span>
                          <strong>{money(minimum)}</strong>
                        </div>
                        <div className="minimum-row">
                          <span>{t('increment')}</span>
                          <span>{money(v.increment)}</span>
                        </div>
                        {status !== 'authenticated' && !initial.demo ? (
                          <Button asChild className="w-full mt-5">
                            <Link href="/login">
                              {t('login')}
                              <ArrowRight size={16} />
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            type="submit"
                            variant="green"
                            size="lg"
                            className="w-full mt-5"
                            disabled={
                              initial.demo ||
                              v.isSample ||
                              expired ||
                              v.status !== 'ACTIVE' ||
                              !hold
                            }
                          >
                            <LockKeyhole size={16} />
                            {t('bidCta')}
                          </Button>
                        )}
                      </form>
                      {!initial.demo &&
                        !v.isSample &&
                        status === 'authenticated' &&
                        !hold &&
                        !expired &&
                        v.status === 'ACTIVE' && (
                          <PaymentHold vehicleId={v.id} onAuthorized={setHold} />
                        )}
                      <p className="fine-print text-center mt-4">{t('holdExplanation')}</p>
                    </>
                  )}
                </>
              )}
              {!isAuction && (
                <OfferForm
                  vehicleId={v.id}
                  price={v.price}
                  disabled={initial.demo || !!v.isSample || v.status !== 'ACTIVE'}
                />
              )}
              {result && (
                <p
                  role="status"
                  className={`notice mt-4 ${result === 'bidSuccess' ? 'success' : ''}`}
                >
                  {t(result)}
                </p>
              )}
            </div>
            {isAuction && (
              <div className="soft-close">
                <Clock3 size={22} />
                <div>
                  <strong>{t('softClose')}</strong>
                  <p>{t('softCloseText')}</p>
                </div>
              </div>
            )}
            <div className="seller-panel">
              <div className="seller-avatar">{v.sellerType === 'DEALER' ? 'H' : 'P'}</div>
              <div>
                <h3>{t('seller')}</h3>
                <SellerBadge vehicle={v} />
                {v.verified && (
                  <p>
                    <CheckCircle2 size={12} />
                    {t('sellerNote')}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
      <Dialog open={gallery} onOpenChange={setGallery}>
        <DialogContent
          lightbox
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setPhoto(
                (p) =>
                  (p + (event.key === 'ArrowLeft' ? -1 : 1) + v.images.length) % v.images.length,
              );
            }
          }}
        >
          <DialogTitle className="text-xl font-semibold pr-8">
            {v.make} {v.model}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500 mb-2">
            {t('photos')}
          </DialogDescription>
          <GalleryPhoto
            key={v.images[photo]}
            src={v.images[photo]}
            alt={t('photo', { number: photo + 1 })}
            onNavigate={(direction) =>
              setPhoto((p) => (p + direction + v.images.length) % v.images.length)
            }
          />
          <PhotoCredit src={v.images[photo]} />
          <div className="flex justify-between mt-4">
            <Button
              variant="outline"
              disabled={v.images.length < 2}
              onClick={() => setPhoto((p) => (p - 1 + v.images.length) % v.images.length)}
              aria-label={t('back')}
            >
              <ArrowLeft size={16} />
            </Button>
            <span aria-live="polite" aria-atomic="true">
              {photo + 1} / {v.images.length}
            </span>
            <Button
              variant="outline"
              disabled={v.images.length < 2}
              onClick={() => setPhoto((p) => (p + 1) % v.images.length)}
              aria-label={t('next')}
            >
              <ArrowRight size={16} />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirm && !biddingClosed}
        onOpenChange={(value) => {
          if (!busy) setConfirm(value);
        }}
      >
        <DialogContent>
          <DialogTitle className="text-2xl font-semibold pr-8">{t('confirmBid')}</DialogTitle>
          <DialogDescription className="text-slate-500 mt-3">
            {t('holdExplanation')}
          </DialogDescription>
          <div className="confirmation-price">{money(Number(amount))}</div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t(localMode?.enabled ? 'localPaymentNotice' : 'bidConsent')}
          </label>
          <Button
            variant="green"
            className="w-full mt-6"
            disabled={!consent || busy || Number(amount) < minimum || expired}
            onClick={() => void submit()}
          >
            {busy ? t('loading') : t('confirmBid')}
          </Button>
          {result === 'bidFailed' && (
            <p role="alert" className="notice mt-4">
              {t('bidFailed')}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
