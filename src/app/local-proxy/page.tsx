import { notFound } from 'next/navigation';
import { LocalProxyWorkspace } from '../../components/local-proxy-workspace';
import { assertLocalProxyEnvironment } from '../../lib/local-proxy-engine';
export const dynamic = 'force-dynamic';
export default function Page() {
  try {
    assertLocalProxyEnvironment(process.env.DATABASE_URL ?? '');
  } catch {
    notFound();
  }
  return <LocalProxyWorkspace />;
}
