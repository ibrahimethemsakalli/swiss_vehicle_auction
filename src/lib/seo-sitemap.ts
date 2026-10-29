import { db } from './db';
import { indexableVehicles } from './seo-data';
import { indexingEnabled, localizedUrl, seoLocales, siteOrigin } from './seo';

export const sitemapPageSize = 1000;
export const xmlText = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export const xmlResponse = (xml: string, status = 200) =>
  new Response(xml, {
    status,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
export function sitemapEntry(origin: string, path: string) {
  const alternatives = [
    ...seoLocales.map(
      (l) =>
        `<xhtml:link rel="alternate" hreflang="${l}" href="${xmlText(localizedUrl(origin, path, l))}"/>`,
    ),
    `<xhtml:link rel="alternate" hreflang="x-default" href="${xmlText(localizedUrl(origin, path, 'de'))}"/>`,
  ].join('');
  return seoLocales
    .map((l) => `<url><loc>${xmlText(localizedUrl(origin, path, l))}</loc>${alternatives}</url>`)
    .join('');
}
export const urlset = (entries: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries}</urlset>`;
export async function sitemapIndex() {
  let entries = '';
  if (indexingEnabled()) {
    const count = await db.vehicle.count({ where: indexableVehicles() });
    const pages = Math.max(1, Math.ceil(count / sitemapPageSize));
    if (pages > 50000) throw new Error('SITEMAP_PARTITION_LIMIT');
    entries = Array.from(
      { length: pages },
      (_, i) => `<sitemap><loc>${xmlText(`${siteOrigin()}/sitemaps/${i}`)}</loc></sitemap>`,
    ).join('');
  }
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`,
  );
}
export async function sitemapPage(page: string) {
  if (!/^(0|[1-9]\d{0,4})$/.test(page) || Number(page) >= 50000)
    return xmlResponse(urlset(''), 404);
  if (!indexingEnabled()) return xmlResponse(urlset(''));
  const rows = await db.vehicle.findMany({
    where: indexableVehicles(),
    select: { id: true },
    orderBy: { id: 'asc' },
    skip: Number(page) * sitemapPageSize,
    take: sitemapPageSize,
  });
  if (!rows.length && page !== '0') return xmlResponse(urlset(''), 404);
  const origin = siteOrigin()!;
  return xmlResponse(
    urlset(
      (page === '0' ? sitemapEntry(origin, '/') : '') +
        rows.map((v) => sitemapEntry(origin, `/vehicles/${encodeURIComponent(v.id)}`)).join(''),
    ),
  );
}
