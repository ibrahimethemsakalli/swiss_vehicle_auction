import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { trustHandlers } from '../../../lib/trust-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = trustHandlers(db, requireUser);
