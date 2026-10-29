import { db } from '../../../../lib/db';
import { requireUser } from '../../../../lib/http';
import { retentionGet } from '../../../../lib/retention-inventory';
export const dynamic = 'force-dynamic';
export const GET = retentionGet(db, requireUser);
