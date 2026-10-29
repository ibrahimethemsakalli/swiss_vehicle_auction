import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/http';
import { draftHandlers } from '../../../lib/listing-draft-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = draftHandlers(db, requireUser);
