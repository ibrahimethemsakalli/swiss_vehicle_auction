import { db } from '../../../../lib/db';
import { requireUser } from '../../../../lib/http';
import { adminQueueHandlers } from '../../../../lib/admin-queue-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = adminQueueHandlers(db, requireUser);
