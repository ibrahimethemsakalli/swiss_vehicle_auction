import { DealerPublic } from '../../../components/dealer-workspace';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DealerPublic id={(await params).id} />;
}
