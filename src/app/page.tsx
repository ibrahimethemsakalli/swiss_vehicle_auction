import { Marketplace } from '../components/marketplace';
import { pageMetadata, seoLocale } from '../lib/seo';
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return pageMetadata('/', seoLocale(query.lang), {
    filtered: Object.keys(query).some((key) => key !== 'lang'),
  });
}
export default function Home() {
  return <Marketplace />;
}
