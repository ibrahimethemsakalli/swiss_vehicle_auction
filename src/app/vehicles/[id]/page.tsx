import { VehicleDetail } from '../../../components/vehicle-detail';
import { notFound } from 'next/navigation';
import { readPublicDetail } from '../../../lib/seo-data';
import { pageMetadata, seoLocale, vehicleJsonLd, safeJsonLd } from '../../../lib/seo';
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export async function generateMetadata({ params, searchParams }: Props) {
  const { id } = await params,
    query = await searchParams;
  const data = await readPublicDetail(id);
  if (!data) return { title: 'AutoVeri.ch', robots: { index: false, follow: false } };
  return pageMetadata(`/vehicles/${encodeURIComponent(id)}`, seoLocale(query.lang), {
    vehicle: data.detail.vehicle,
    eligible: data.eligible,
  });
}
export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const data = await readPublicDetail(id);
  if (!data) notFound();
  const json = vehicleJsonLd(
    data.detail.vehicle,
    seoLocale((await searchParams).lang),
    data.eligible,
  );
  return (
    <>
      {json && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(json) }} />
      )}
      <VehicleDetail id={id} initial={data.detail} />
    </>
  );
}
