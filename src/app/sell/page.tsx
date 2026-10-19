import { ListingWizard } from '../../components/listing-wizard';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '../../lib/auth';
export default async function Page() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as { id?: string } | undefined)?.id) redirect('/login?next=/sell');
  return <ListingWizard />;
}
