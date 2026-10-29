import assert from 'node:assert/strict';
const base = process.env.SEO_TEST_ORIGIN || 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const id = process.env.SEO_TEST_VEHICLE_ID;
assert.ok(id, 'Supply an existing local public sample vehicle ID');
const titles = {
  de: 'Fahrzeuge in der Schweiz',
  fr: 'Véhicules en Suisse',
  it: 'Veicoli in Svizzera',
  en: 'Vehicles in Switzerland',
};
for (const [lang, title] of Object.entries(titles)) {
  const response = await fetch(`${base}/?lang=${lang}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-robots-tag'), /noindex/);
  const html = await response.text();
  assert.ok(html.includes(`<html lang="${lang}">`));
  assert.ok(html.includes(`<title>${title} | AutoVeri.ch</title>`));
  const detail = await fetch(`${base}/vehicles/${id}?lang=${lang}`, {
    headers: { 'User-Agent': 'Twitterbot' },
  });
  assert.equal(detail.status, 200);
  const content = await detail.text();
  assert.ok(content.includes(`<html lang="${lang}">`));
  assert.ok(content.includes('<h1'));
  assert.ok(content.includes('property="og:title"'));
  assert.ok(content.includes('noindex'));
  assert.ok(!content.includes('application/ld+json'));
  assert.ok(!content.includes('rel="canonical"'));
}
for (const path of ['/admin', '/dashboard', '/login', '/api/market', '/sitemap.xml']) {
  const r = await fetch(base + path);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
}
const sitemap = await (await fetch(base + '/sitemap.xml')).text();
assert.ok(!sitemap.includes('<loc>'));
const missing = await fetch(base + '/vehicles/00000000-0000-4000-8000-000000000000', {
  headers: { 'User-Agent': 'Twitterbot' },
});
assert.equal(missing.status, 404);
console.log(
  'PASS: four-language SSR titles/html lang, server detail/OG, local/private noindex, empty sitemap and missing listing 404.',
);
