import { sitemapPage } from '../../../lib/seo-sitemap';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ page: string }> }) {
  return sitemapPage((await params).page);
}
