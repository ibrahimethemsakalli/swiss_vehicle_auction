import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { dealerHandlers } from '../../../lib/dealer-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = dealerHandlers(db, requireUser);
