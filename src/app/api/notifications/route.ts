import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { notificationHandlers } from '../../../lib/notification-http';
export const dynamic = 'force-dynamic';
export const { GET, PATCH } = notificationHandlers(db, requireUser);
