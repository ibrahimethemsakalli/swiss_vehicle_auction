import { db } from '../../../../../lib/db';
import { requireUser } from '../../../../../lib/http';
import { protectionHandlers } from '../../../../../lib/retention-protection';
export const dynamic = 'force-dynamic';
export const { GET, POST } = protectionHandlers(db, requireUser);
