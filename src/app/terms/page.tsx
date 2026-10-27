import { LegalPage } from '../../components/legal-pages';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ version?: string; lang?: string }>;
}) {
  const query = await searchParams;
  return <LegalPage kind="TERMS" version={query.version} language={query.lang} />;
}
