import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { localProxyHandlers } from '../../../lib/local-proxy-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = localProxyHandlers(db, requireUser, process.env.DATABASE_URL ?? '');
