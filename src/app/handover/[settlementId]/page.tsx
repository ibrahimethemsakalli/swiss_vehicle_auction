import { HandoverPage } from '../../../components/handover';
export default async function Page({ params }: { params: Promise<{ settlementId: string }> }) {
  const { settlementId } = await params;
  return <HandoverPage settlementId={settlementId} />;
}
