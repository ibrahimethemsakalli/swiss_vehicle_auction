import { VehicleDetail } from '../../../components/vehicle-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VehicleDetail id={id} />;
}
