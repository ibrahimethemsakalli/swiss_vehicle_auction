import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { messagingHandlers } from '../../../lib/messaging-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = messagingHandlers(db, requireUser);
