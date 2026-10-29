import { DraftLibrary } from '../../components/draft-library';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth';
import { redirect } from 'next/navigation';
export default async function Page() {
  const s = await getServerSession(authOptions);
  if (!(s?.user as { id?: string })?.id) redirect('/login?next=/sell');
  return <DraftLibrary />;
}
