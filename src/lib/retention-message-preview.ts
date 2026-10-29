import { addUtcCalendarMonths } from './retention-calendar';

export type MessageActivity = {
  createdAt: Date;
  lastMessageAt: Date | null;
  lastAppointmentAt: Date | null;
  evidence: boolean;
  activeAppointment: boolean;
  unknownAppointment: boolean;
};

// PM-26D approved policy: classification only, never a deletion instruction.
export function classifyMessageConversation(row: MessageActivity, observedAt: Date) {
  if (row.evidence || row.activeAppointment)
    return { state: 'protected' as const, reason: 'evidence' as const };
  const dates = [row.createdAt, row.lastMessageAt, row.lastAppointmentAt].filter(
    (date): date is Date => date !== null,
  );
  if (
    row.unknownAppointment ||
    !row.lastMessageAt ||
    !Number.isFinite(observedAt.getTime()) ||
    dates.some((date) => !Number.isFinite(date.getTime()) || date > observedAt)
  )
    return { state: 'unknown' as const, reason: 'unknown' as const };
  const lastActivity = new Date(Math.max(...dates.map((date) => date.getTime())));
  const dueAt = addUtcCalendarMonths(lastActivity, 6);
  if (!dueAt) return { state: 'unknown' as const, reason: 'unknown' as const };
  return {
    state: observedAt >= dueAt ? ('candidate' as const) : ('protected' as const),
    reason: observedAt >= dueAt ? ('elapsed' as const) : ('notDue' as const),
  };
}
