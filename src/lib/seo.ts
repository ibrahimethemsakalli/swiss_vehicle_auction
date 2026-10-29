import type { Metadata } from 'next';
import type { VehicleView } from './market-types';
import { launchEnvironmentIssues } from './launch-gate';

export const seoLocales = ['de', 'fr', 'it', 'en'] as const;
export type SeoLocale = (typeof seoLocales)[number];
export const seoLocale = (value: unknown): SeoLocale =>
  seoLocales.includes(value as SeoLocale) ? (value as SeoLocale) : 'de';
export const publicSeoPath = (path: string) => path === '/' || /^\/vehicles\/[^/]+$/.test(path);
export function siteOrigin(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  try {
    const url = new URL(env.PUBLIC_SITE_URL ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !url.hostname.includes('.') ||
      /(?:\.(?:test|local|localhost|invalid|example)$|^localhost$|^\[|^[\d.]+$)/i.test(url.hostname)
    )
      return;
    return url.origin;
  } catch {
    return;
  }
}
export function indexingEnabled(env: Record<string, string | undefined> = process.env) {
  return (
    !!siteOrigin(env) &&
    env.SEO_INDEXING_ENABLED === 'true' &&
    env.NODE_ENV === 'production' &&
    env.LAUNCH_MODE === 'public' &&
    launchEnvironmentIssues(env).length === 0 &&
    env.LOCAL_TEST_PAYMENTS !== 'true' &&
    env.LOCAL_TEST_MESSAGES !== 'true' &&
    !!env.DATABASE_URL
  );
}
export const seoCopy = {
  de: {
    title: 'Fahrzeuge in der Schweiz',
    description: 'Fahrzeuginserate, Auktionen und Angebote in der Schweiz entdecken.',
    active: 'Aktives Inserat',
    sold: 'Verkauft',
    cancelled: 'Abgebrochen',
    expired: 'Beendet',
    sample: 'Beispielinserat',
  },
  fr: {
    title: 'Véhicules en Suisse',
    description: 'Découvrez les annonces de véhicules, les enchères et les offres en Suisse.',
    active: 'Annonce active',
    sold: 'Vendu',
    cancelled: 'Annulé',
    expired: 'Terminé',
    sample: 'Annonce de démonstration',
  },
  it: {
    title: 'Veicoli in Svizzera',
    description: 'Scopri annunci di veicoli, aste e offerte in Svizzera.',
    active: 'Annuncio attivo',
    sold: 'Venduto',
    cancelled: 'Annullato',
    expired: 'Terminato',
    sample: 'Annuncio dimostrativo',
  },
  en: {
    title: 'Vehicles in Switzerland',
    description: 'Discover vehicle listings, auctions and offers in Switzerland.',
    active: 'Active listing',
    sold: 'Sold',
    cancelled: 'Cancelled',
    expired: 'Ended',
    sample: 'Sample listing',
  },
};
export function vehicleSeoStatus(v: VehicleView, now = Date.now()) {
  if (v.saleCancelled || v.status === 'CANCELLED') return 'cancelled';
  if (v.status === 'SOLD') return 'sold';
  if (
    v.status !== 'ACTIVE' ||
    (v.listingType === 'AUCTION_7_DAYS' &&
      (!v.end || Date.parse(v.end) <= now || !Number.isFinite(Date.parse(v.end))))
  )
    return 'expired';
  return 'active';
}
export function localizedUrl(origin: string, path: string, locale: SeoLocale) {
  return `${origin}${path}?lang=${locale}`;
}
export function safeImage(image: string, origin?: string) {
  try {
    if (image.startsWith('//')) return;
    const url = new URL(image, origin);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return;
  }
}
export function pageMetadata(
  path: string,
  locale: SeoLocale,
  options: {
    vehicle?: VehicleView;
    eligible?: boolean;
    filtered?: boolean;
  } = {},
  env: Record<string, string | undefined> = process.env,
): Metadata {
  const origin = siteOrigin(env),
    copy = seoCopy[locale],
    v = options.vehicle;
  const state = v ? vehicleSeoStatus(v) : undefined;
  const title = v
    ? `${v.make} ${v.model} · ${copy[v.isSample ? 'sample' : state!]} | AutoVeri.ch`
    : `${copy.title} | AutoVeri.ch`;
  const description = v
    ? `${v.make} ${v.model} · ${copy[v.isSample ? 'sample' : state!]} · ${v.canton}`
    : copy.description;
  const canonical = origin ? localizedUrl(origin, path, locale) : undefined;
  const images = v?.images
    .map((i) => safeImage(i, origin))
    .filter((i): i is string => !!i)
    .slice(0, 1);
  return {
    title,
    description,
    robots: {
      index:
        indexingEnabled(env) &&
        !options.filtered &&
        (!v || (!!options.eligible && !v.isSample && state === 'active')),
      follow: true,
    },
    alternates: origin
      ? {
          canonical,
          languages: Object.fromEntries([
            ...seoLocales.map((l) => [l, localizedUrl(origin, path, l)]),
            ['x-default', localizedUrl(origin, path, 'de')],
          ]),
        }
      : undefined,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'AutoVeri.ch',
      locale: `${locale}_CH`,
      url: canonical,
      images,
    },
    twitter: {
      card: images?.length ? 'summary_large_image' : 'summary',
      title,
      description,
      images,
    },
  };
}
// Auction bids are not a fixed purchase price. No Offer, rating, VIN or personal address is emitted.
export function vehicleJsonLd(
  v: VehicleView,
  locale: SeoLocale,
  eligible: boolean,
  env: Record<string, string | undefined> = process.env,
) {
  const origin = siteOrigin(env);
  if (
    !origin ||
    !indexingEnabled(env) ||
    !eligible ||
    v.isSample ||
    vehicleSeoStatus(v) !== 'active'
  )
    return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: `${v.make} ${v.model}`,
    brand: { '@type': 'Brand', name: v.make },
    model: v.model,
    url: localizedUrl(origin, `/vehicles/${encodeURIComponent(v.id)}`, locale),
    image: v.images.map((i) => safeImage(i, origin)).filter(Boolean),
    ...(v.modelYear ? { vehicleModelDate: String(v.modelYear) } : {}),
    ...(v.mileage != null
      ? { mileageFromOdometer: { '@type': 'QuantitativeValue', value: v.mileage, unitCode: 'KMT' } }
      : {}),
  };
}
export const safeJsonLd = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
