import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { savedSearchHandlers } from '../../../lib/saved-search-http';
export const dynamic = 'force-dynamic';
const handlers = savedSearchHandlers(db, requireUser);
export const GET = handlers.GET;
export const POST = handlers.POST;
