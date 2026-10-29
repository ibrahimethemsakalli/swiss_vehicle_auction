import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { appointmentCalendar } from './appointment-calendar';
import de from '../messages/de.json';
import fr from '../messages/fr.json';
import it from '../messages/it.json';
import en from '../messages/en.json';
const query = z
  .object({ id: z.uuid(), lang: z.enum(['de', 'fr', 'it', 'en']).default('de') })
  .strict();
export function appointmentCalendarHandler(db: PrismaClient, authenticate: () => Promise<string>) {
  return async (req: Request) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
    };
    try {
      const userId = await authenticate();
      const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { suspendedAt: true, isSample: true },
      });
      if (!user || user.suspendedAt || user.isSample) throw Error('FORBIDDEN');
      const a = await db.appointment.findFirst({
        where: { id: q.id, conversation: { OR: [{ buyerId: userId }, { sellerId: userId }] } },
        include: {
          conversation: { include: { vehicle: { select: { make: true, model: true } } } },
        },
      });
      if (!a) throw Error('FORBIDDEN');
      if (a.status !== 'ACCEPTED' || a.startsAt <= new Date()) throw Error('CHAT_CONFLICT');
      const messages = { de, fr, it, en }[q.lang];
      return new Response(
        appointmentCalendar(
          a,
          `${messages.chatCalendarTitle}: ${a.conversation.vehicle.make} ${a.conversation.vehicle.model}`,
          messages.chatCalendarNote,
        ),
        {
          headers: {
            ...headers,
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="appointment-${a.id}.ics"`,
          },
        },
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      const status =
        code === 'UNAUTHORIZED'
          ? 401
          : code === 'FORBIDDEN'
            ? 403
            : code === 'CHAT_CONFLICT'
              ? 409
              : e instanceof z.ZodError
                ? 400
                : 503;
      return Response.json(
        { error: status === 503 ? 'CHAT_FAILED' : status === 400 ? 'CHAT_INVALID' : code },
        { status, headers },
      );
    }
  };
}
