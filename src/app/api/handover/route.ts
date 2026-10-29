import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { handoverHandlers } from '../../../lib/handover-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = handoverHandlers(db, requireUser);
