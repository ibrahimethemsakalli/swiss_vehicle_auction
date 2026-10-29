import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { supportHandlers } from '../../../lib/support-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = supportHandlers(db, requireUser);
