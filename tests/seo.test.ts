import test from 'node:test';
import assert from 'node:assert/strict';
import { demoVehicles } from '../src/lib/demo';
import {
  indexingEnabled,
  siteOrigin,
  pageMetadata,
  vehicleJsonLd,
  safeJsonLd,
  seoLocales,
  safeImage,
  vehicleSeoStatus,
  publicSeoPath,
} from '../src/lib/seo';
import { sitemapEntry, urlset, sitemapPage, sitemapIndex } from '../src/lib/seo-sitemap';
import { searchHref, defaultFilters } from '../src/lib/search-state';
const production = {
  NODE_ENV: 'production',
  PUBLIC_SITE_URL: 'https://cars.example.org',
  SEO_INDEXING_ENABLED: 'true',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1/seo_test',
  LAUNCH_MODE: 'public',
  LAUNCH_LEGAL_VERSION: 'synthetic-v1',
  NEXTAUTH_URL: 'https://cars.example.org',
  NEXTAUTH_SECRET: 'synthetic-unit-test-key-01234567890123456789',
  UPLOAD_DIR: '/synthetic/uploads',
  LOCAL_PROXY_ENGINE: 'false',
  LOCAL_REFUND_POLICY_WORKER: 'false',
  LOCAL_TEST_MESSAGES: 'false',
  LOCAL_TEST_PAYMENTS: 'false',
} as NodeJS.ProcessEnv;
const vehicle = {
  ...demoVehicles()[0],
  isSample: false,
  status: 'ACTIVE',
  saleCancelled: false,
  end: new Date(Date.now() + 600000).toISOString(),
};
test('SEO launch is explicit; localhost, credentials, invalid URLs and test modes fail closed', () => {
  assert.equal(indexingEnabled(production), true);
  for (const url of [
    '',
    'http://cars.example.org',
    'https://localhost',
    'https://127.0.0.1',
    'https://demo.test',
    'https://a:b@cars.example.org',
    'https://cars.example.org/path',
    'https://cars.example.org/?a=1',
  ])
    assert.equal(siteOrigin({ ...production, PUBLIC_SITE_URL: url }), undefined);
  for (const patch of [
    { NODE_ENV: 'development' },
    { SEO_INDEXING_ENABLED: 'false' },
    { LOCAL_TEST_PAYMENTS: 'true' },
    { LOCAL_TEST_MESSAGES: 'true' },
    { DATABASE_URL: '' },
  ])
    assert.equal(indexingEnabled({ ...production, ...patch }), false);
  for (const path of ['/admin', '/api/market', '/dev/mobile-audit', '/dashboard', '/handover/id'])
    assert.equal(publicSeoPath(path), false);
});
test('four language metadata has canonical alternatives, genuine status and no filtered indexing', () => {
  for (const locale of seoLocales) {
    const meta = pageMetadata('/vehicles/id', locale, { vehicle, eligible: true }, production);
    assert.equal((meta.robots as { index: boolean }).index, true);
    assert.equal(meta.alternates?.canonical, `https://cars.example.org/vehicles/id?lang=${locale}`);
    assert.equal(Object.keys(meta.alternates!.languages!).length, 5);
    assert.ok(meta.openGraph);
    assert.equal(
      (pageMetadata('/', locale, { filtered: true }, production).robots as { index: boolean })
        .index,
      false,
    );
    for (const patch of [
      { status: 'SOLD' },
      { saleCancelled: true },
      { status: 'EXPIRED' },
      { end: '2000-01-01' },
      { end: null },
      { isSample: true },
    ]) {
      const v = { ...vehicle, ...patch };
      assert.equal(
        (
          pageMetadata('/vehicles/id', locale, { vehicle: v, eligible: true }, production)
            .robots as { index: boolean }
        ).index,
        false,
      );
      assert.equal(vehicleJsonLd(v, locale, true, production), null);
    }
  }
  assert.equal(vehicleSeoStatus({ ...vehicle, status: 'SOLD', saleCancelled: true }), 'cancelled');
  assert.equal(
    pageMetadata('/', 'en', {}, { ...production, PUBLIC_SITE_URL: '' }).alternates,
    undefined,
  );
});
test('structured data avoids invented years, bid-as-price and private data; script and image URLs are safe', () => {
  const result = vehicleJsonLd(
    { ...vehicle, model: '</script><script>alert(1)</script>', modelYear: null },
    'en',
    true,
    production,
  )!;
  assert.equal(result['@type'], 'Car');
  for (const field of ['offers', 'price', 'vehicleModelDate', 'vin', 'stammnummer', 'seller'])
    assert.equal(field in result, false);
  assert.ok(!safeJsonLd(result).includes('<'));
  assert.equal(JSON.parse(safeJsonLd(result)).model, result.model);
  for (const image of [
    'javascript:alert(1)',
    '//evil.test/a',
    'data:image/png,x',
    'https://u:p@cars.example.org/a',
  ])
    assert.equal(safeImage(image, production.PUBLIC_SITE_URL), undefined);
});
test('sitemap uses escaped four-language public URLs; local sitemap is empty and does not require a database', async () => {
  const xml = urlset(sitemapEntry('https://cars.example.org', '/vehicles/a&b'));
  assert.equal((xml.match(/<url>/g) ?? []).length, 4);
  assert.ok(xml.includes('a&amp;b'));
  assert.ok(!xml.includes('lastmod')); // Do not invent modification dates.
  assert.equal((await sitemapPage('../admin')).status, 404);
  assert.ok(!(await (await sitemapIndex()).text()).includes('<loc>'));
  const href = searchHref(
    { filters: { ...defaultFilters, make: 'BMW' }, page: 1, onlySaved: false },
    '/?lang=fr',
  );
  assert.equal(new URL(href, 'https://cars.example.org').searchParams.get('lang'), 'fr');
});
