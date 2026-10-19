'use client';
import Link from 'next/link';
import { AdvancedFilters } from './advanced-filters';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Heart,
  MapPin,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { useLocale } from './providers';
import { Button } from './ui/button';
import { Input } from './ui/input';
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
import {
  cantons,
  filterVehicles,
  vehicleYear,
  type Filters,
  type VehicleView,
} from '../lib/market-types';
const initial: Filters = {
  query: '',
  canton: '',
  price: Number.MAX_SAFE_INTEGER,
  mileage: Number.MAX_SAFE_INTEGER,
  privateOnly: true,
  mfk: false,
  sort: 'ending',
};
export function Marketplace() {
  const filterPanel = useRef<HTMLElement>(null);
  const resultsPanel = useRef<HTMLDivElement>(null);
  const closeMobileFilters = () => {
    setMobileFilters(false);
    requestAnimationFrame(() => {
      resultsPanel.current?.focus({ preventScroll: true });
      resultsPanel.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  };
  const { t, money, number } = useLocale();
  const { data: localMode } = useResource<{ enabled: boolean }>('/api/local-test');
  const [updatesPaused, setUpdatesPaused] = useState(false);
  const paused = !!localMode?.enabled && updatesPaused;
  const [filters, setFilters] = useState(initial);
  const [page, setPage] = useState(1);
  const [onlySaved, setOnlySaved] = useState(false);
  const [searchUrl, setSearchUrl] = useState('/api/market');
  useEffect(() => {
    if (onlySaved) return;
    const timer = setTimeout(
      () =>
        setSearchUrl(
          '/api/market?filters=' + encodeURIComponent(JSON.stringify(filters)) + '&page=' + page,
        ),
      250,
    );
    return () => clearTimeout(timer);
  }, [filters, page, onlySaved]);
  const changeFilters = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };
  const { data, error, loading, reload } = useResource<{
    demo: boolean;
    vehicles: VehicleView[];
    total: number;
    catalog: { make: string; model: string }[];
  }>(searchUrl);
  const [catalog, setCatalog] = useState<{ make: string; model: string }[]>([]);
  useEffect(() => {
    if (data?.catalog) setCatalog(data.catalog);
  }, [data]);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [savedVehicles, setSavedVehicles] = useState<VehicleView[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('autoveri-saved') ?? '[]');
      if (Array.isArray(parsed)) setFavorites(parsed.filter((x) => typeof x === 'string'));
    } catch {}
  }, []);
  const save = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem('autoveri-saved', JSON.stringify(next));
    } catch {}
  };
  useEffect(() => {
    if (!onlySaved || !data || paused) return;
    const controller = new AbortController();
    setSavedLoading(true);
    setSavedError(false);
    let pending = false;
    const refresh = () => {
      if (pending || controller.signal.aborted) return;
      pending = true;
      Promise.all(
        favorites.map(async (id) => {
          const response = await fetch(`/api/market/${encodeURIComponent(id)}`, {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (response.status === 404) return null;
          if (!response.ok) throw new Error('Saved listing unavailable');
          return (await response.json()).vehicle as VehicleView;
        }),
      )
        .then((items) => {
          if (!controller.signal.aborted) {
            setSavedVehicles((previous) =>
              items
                .filter((v): v is VehicleView => v !== null)
                .map((v) => {
                  const current = previous.find((item) => item.id === v.id);
                  return current && current.version > v.version ? current : v;
                }),
            );
            setSavedError(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setSavedError(true);
        })
        .finally(() => {
          pending = false;
          if (!controller.signal.aborted) setSavedLoading(false);
        });
    };
    refresh();
    const interval = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [onlySaved, favorites, data, paused]);
  useEffect(() => {
    if (!onlySaved || !data || data.demo || favorites.length === 0 || paused) return;
    const socket = io({ withCredentials: true });
    socket.on('connect', () => {
      favorites.forEach((id) => socket.emit('auction.subscribe', id));
    });
    const apply = (event: {
      id?: string;
      vehicleId?: string;
      version: number;
      auctionEndsAt: string;
      status?: string;
      amount?: string;
      currentPrice?: string | null;
    }) => {
      setSavedVehicles((items) =>
        items.map((v) => {
          if (v.id !== (event.id ?? event.vehicleId) || event.version < v.version) return v;
          return {
            ...v,
            end: event.auctionEndsAt,
            version: event.version,
            status: event.status ?? v.status,
            price: Number(event.amount ?? event.currentPrice ?? v.price),
            hasBids: !!(event.amount ?? event.currentPrice) || v.hasBids,
          };
        }),
      );
    };
    socket.on('auction.snapshot', apply);
    socket.on('auction.updated', apply);
    return () => {
      socket.disconnect();
    };
  }, [onlySaved, favorites, data, paused]);
  const vehicles = useMemo(
    () =>
      (onlySaved ? filterVehicles(savedVehicles, filters) : (data?.vehicles ?? [])).filter(
        (v) => !onlySaved || favorites.includes(v.id),
      ),
    [data, filters, onlySaved, favorites, savedVehicles],
  );
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    changeFilters({ ...filters, [key]: value });
  return (
    <>
      {data?.demo && <DemoBanner />}
      {localMode?.enabled && onlySaved && (
        <div className="container notice">
          <Button variant="outline" onClick={() => setUpdatesPaused((value) => !value)}>
            {t(paused ? 'localResumeUpdates' : 'localPauseUpdates')}
          </Button>
          {paused && <p role="status">{t('localUpdatesPaused')}</p>}
        </div>
      )}
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">
              <span />
              {t('heroTag')}
            </p>
            <h1>
              {t('hero1')}
              <br />
              <span>{t('hero2')}</span>
            </h1>
            <p className="hero-description">{t('heroText')}</p>
            <div className="hero-actions">
              <Button size="lg" variant="green" asChild>
                <a href="#vehicles">
                  {t('explore')}
                  <ArrowRight size={17} />
                </a>
              </Button>
              <a className="text-link" href="#how-it-works">
                {t('how')}
                <ArrowUpRight size={16} />
              </a>
            </div>
            <div className="hero-signoff">
              <span className="swiss-flag">✚</span>
              {t('swiss')}
            </div>
          </div>
          <div className="hero-visual">
            <VehicleImage
              src="https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1400&q=85"
              alt="Porsche"
            />
            <div className="hero-image-shade" />
            <div className="hero-photo-caption">
              <span>01 / AUTOVERI</span>
              <b>{t('privateDirect')}</b>
            </div>
            <div className="floating-verification">
              <span>
                <ShieldCheck size={26} />
              </span>
              <div>
                <strong>{t('verifiedData')}</strong>
                <small>{t('privateHint')}</small>
              </div>
              <Check size={18} />
            </div>
          </div>
        </div>
      </section>
      <div className="trust-strip">
        <div className="container">
          {[
            [ShieldCheck, 'verifiedData'],
            [Users, 'privateDirect'],
            [Clock3, 'fairAuctions'],
          ].map(([Icon, key]) => {
            const I = Icon as typeof ShieldCheck;
            return (
              <span key={String(key)}>
                <I size={19} />
                {t(key as 'verifiedData')}
              </span>
            );
          })}
        </div>
      </div>
      <section className="container market-section" id="vehicles">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t('collection')}</p>
            <h2>{t('listings')}</h2>
          </div>
          <div className="segmented">
            <button
              aria-pressed={!onlySaved}
              className={!onlySaved ? 'selected' : ''}
              onClick={() => setOnlySaved(false)}
            >
              {t('all')}
            </button>
            <button
              aria-pressed={onlySaved}
              className={onlySaved ? 'selected' : ''}
              onClick={() => setOnlySaved(true)}
            >
              <Heart size={14} />
              {t('favorites')}
              <span>{favorites.length}</span>
            </button>
          </div>
        </div>
        <div className="market-layout">
          <aside
            id="vehicle-filters"
            ref={filterPanel}
            tabIndex={-1}
            aria-labelledby="vehicle-filters-heading"
            className={`filters-panel ${mobileFilters ? 'mobile-open' : ''}`}
          >
            <div className="filter-heading">
              <h3 id="vehicle-filters-heading">
                <SlidersHorizontal size={17} />
                {t('filters')}
              </h3>
              <button
                onClick={() => {
                  changeFilters(initial);
                }}
              >
                {t('reset')}
              </button>
              <button className="mobile-filter-action" onClick={closeMobileFilters}>
                {t('close')}
              </button>
              <Button
                className="mobile-filter-action mobile-filter-results"
                onClick={closeMobileFilters}
              >
                {t('showResults')}
              </Button>
            </div>
            <label className="private-toggle">
              <div>
                <strong>{t('privateOnly')}</strong>
                <small>{t('privateHint')}</small>
              </div>
              <input
                type="checkbox"
                role="switch"
                checked={filters.privateOnly}
                onChange={(e) => update('privateOnly', e.target.checked)}
              />
              <span className="switch-track" />
            </label>
            <label className="form-label">
              {t('canton')}
              <select
                className="field"
                value={filters.canton}
                onChange={(e) => update('canton', e.target.value)}
              >
                <option value="">{t('allCantons')}</option>
                {cantons.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <AdvancedFilters
              filters={filters}
              change={changeFilters}
              catalog={onlySaved ? savedVehicles : catalog}
            />
            <label className="check-label">
              <input
                type="checkbox"
                checked={filters.mfk}
                onChange={(e) => update('mfk', e.target.checked)}
              />
              {t('mfkOnly')}
            </label>
            <div className="filter-note">
              <ShieldCheck size={22} />
              <strong>{t('verifiedData')}</strong>
              <p>{t('how1Text')}</p>
            </div>
            <Button
              className="mobile-filter-action mobile-filter-results"
              onClick={closeMobileFilters}
            >
              {t('showResults')}
            </Button>
          </aside>
          <div className="market-results" ref={resultsPanel} tabIndex={-1}>
            <div className="search-row">
              <label className="search-field">
                <Search size={18} />
                <Input
                  placeholder={t('search')}
                  aria-label={t('search')}
                  value={filters.query}
                  onChange={(e) => update('query', e.target.value)}
                />
              </label>
              <Button
                className="filter-mobile-button"
                variant="outline"
                onClick={() => {
                  if (mobileFilters) return closeMobileFilters();
                  setMobileFilters(true);
                  requestAnimationFrame(() => {
                    filterPanel.current?.focus({ preventScroll: true });
                    filterPanel.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
                  });
                }}
                aria-controls="vehicle-filters"
                aria-expanded={mobileFilters}
              >
                <SlidersHorizontal size={17} />
                {t('filters')}
              </Button>
            </div>
            <div className="results-row">
              <p aria-live="polite">
                {t('results', { count: onlySaved ? vehicles.length : (data?.total ?? 0) })}
              </p>
              <label>
                <span className="sr-only">{t('sort')}</span>
                <select value={filters.sort} onChange={(e) => update('sort', e.target.value)}>
                  <option value="ending">{t('ending')}</option>
                  <option value="priceAsc">{t('priceAsc')}</option>
                  <option value="priceDesc">{t('priceDesc')}</option>
                </select>
              </label>
            </div>
            {loading || (onlySaved && savedLoading) ? (
              <Loading />
            ) : error || (onlySaved && savedError) ? (
              <ErrorState retry={reload} />
            ) : vehicles.length === 0 ? (
              <div className="empty-state">
                <Search size={32} />
                <h3>{t('noResults')}</h3>
                <p>{t('tryFilters')}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    changeFilters(initial);
                  }}
                >
                  {t('reset')}
                </Button>
              </div>
            ) : (
              <div className="vehicle-grid">
                {vehicles.map((v) => {
                  const cardStatus = v.saleCancelled
                    ? 'CANCELLED'
                    : v.status === 'ACTIVE' && v.end && now !== null && Date.parse(v.end) <= now
                      ? 'auctionChecking'
                      : v.status;
                  return (
                    <article className="vehicle-card" key={v.id}>
                      <div className="card-photo">
                        <Link
                          href={`/vehicles/${v.id}`}
                          aria-label={`${t('view')}: ${v.make} ${v.model}`}
                        >
                          <VehicleImage
                            src={v.images[0]}
                            alt={`${v.make} ${v.model}`}
                            loading="lazy"
                          />
                        </Link>
                        {!v.isSample && <MfkBadge date={v.mfkDate} />}
                        <button
                          className={`favorite-button ${favorites.includes(v.id) ? 'is-saved' : ''}`}
                          aria-label={`${t(favorites.includes(v.id) ? 'saved' : 'save')}: ${v.make} ${v.model}`}
                          aria-pressed={favorites.includes(v.id)}
                          onClick={() => save(v.id)}
                        >
                          <Heart
                            size={17}
                            fill={favorites.includes(v.id) ? 'currentColor' : 'none'}
                          />
                        </button>
                      </div>
                      <div className="card-content">
                        <SellerBadge vehicle={v} />
                        {v.saleCancelled && (
                          <p className="mt-2">
                            <StatusBadge status="CANCELLED" />
                          </p>
                        )}
                        <Link href={`/vehicles/${v.id}`} className="card-title">
                          {v.make} {v.model}
                        </Link>
                        <p className="card-specs">
                          {vehicleYear(v) ?? t('unverified')}
                          <span /> {number(v.mileage)} km
                          <span />
                          {v.powerKw ?? '—'} kW
                        </p>
                        <p className="card-location">
                          <MapPin size={12} />
                          {v.canton}, CH
                        </p>
                        <p className="card-specs">
                          {v.fuelType && t(v.fuelType)}
                          {v.transmission && <> · {t(v.transmission)}</>}
                          {v.fuelConsumption != null && (
                            <> · {number(v.fuelConsumption)} L/100 km</>
                          )}
                          {v.electricConsumption != null && (
                            <> · {number(v.electricConsumption)} kWh/100 km</>
                          )}
                        </p>
                        {cardStatus !== 'ACTIVE' ? (
                          <p className="notice mt-3">
                            {t(
                              cardStatus === 'auctionChecking'
                                ? 'auctionChecking'
                                : 'biddingClosed',
                            )}
                          </p>
                        ) : (
                          <div className="card-bid">
                            <div>
                              <small>
                                {t(
                                  v.listingType === 'FIXED_PRICE_OFFERS'
                                    ? 'fixedPrice'
                                    : v.hasBids
                                      ? 'currentBid'
                                      : 'startingPrice',
                                )}
                              </small>
                              <strong>{money(v.price)}</strong>
                            </div>
                            {v.listingType === 'AUCTION_7_DAYS' && (
                              <span>
                                {v.bidCount} {t('bids')}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="card-bottom">
                          {cardStatus !== 'ACTIVE' ? (
                            <StatusBadge status={cardStatus} />
                          ) : (
                            <Countdown end={v.end} />
                          )}
                          <Link href={`/vehicles/${v.id}`} aria-label={`${t('view')}: ${v.make}`}>
                            <ArrowUpRight size={19} />
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {!onlySaved && (data?.total ?? 0) > 24 && (
              <div className="wizard-actions">
                <Button
                  variant="outline"
                  disabled={page === 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t('back')}
                </Button>
                <span>
                  {page} / {Math.ceil((data?.total ?? 0) / 24)}
                </span>
                <Button
                  variant="outline"
                  disabled={page * 24 >= (data?.total ?? 0) || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('next')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="how-section" id="how-it-works">
        <div className="container">
          <p className="eyebrow">AUTOVERI</p>
          <h2>{t('howTitle')}</h2>
          <div className="how-grid">
            {[1, 2, 3].map((n) => (
              <div key={n}>
                <span className="step-number">0{n}</span>
                <h3>{t(`how${n}Title` as 'how1Title')}</h3>
                <p>{t(`how${n}Text` as 'how1Text')}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
