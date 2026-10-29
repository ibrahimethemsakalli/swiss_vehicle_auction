import { notFound } from 'next/navigation';
import { ProxySimulator } from '../../components/proxy-simulator';
export const dynamic = 'force-dynamic';
export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <ProxySimulator />;
}
