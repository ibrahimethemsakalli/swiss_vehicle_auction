import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { favoriteHandlers } from '../../../lib/favorite-http';
export const dynamic = 'force-dynamic';
const handlers = favoriteHandlers(db, requireUser);
export const GET = handlers.GET;
export const POST = handlers.POST;
