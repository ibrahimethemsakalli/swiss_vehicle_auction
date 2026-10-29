import type { MetadataRoute } from 'next';
import { indexingEnabled, siteOrigin } from '../lib/seo';
export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  // Crawlers must be allowed to read the noindex response on private/staging URLs.
  return {
    rules: { userAgent: '*', allow: '/' },
    ...(indexingEnabled() ? { sitemap: `${siteOrigin()}/sitemap.xml` } : {}),
  };
}
