import { db } from '../../../../lib/db';
import { requireUser } from '../../../../lib/http';
import { appointmentCalendarHandler } from '../../../../lib/appointment-calendar-http';
export const dynamic = 'force-dynamic';
export const GET = appointmentCalendarHandler(db, requireUser);
