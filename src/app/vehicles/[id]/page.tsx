import { VehicleDetail } from '../../../components/vehicle-detail';
export default function Page({ params }: { params: { id: string } }) {
  return <VehicleDetail id={params.id} />;
}
