import type { RefundPolicy } from './refund-domain';

/** Product owner approval, 2026-10-29. No provider, personnel or retention defaults. */
export const approvedRefundPolicy: RefundPolicy = Object.freeze({
  version: 'L11-2026-10-29-A',
  reviewRulesConfirmed: true,
  partialRefunds: false,
  requiredApprovals: 2,
  separateExecutor: false,
});
export const refundTargets = Object.freeze({
  firstResponseBusinessDays: 2,
  decisionBusinessDays: 5,
  updateBusinessDays: 5,
  informationCalendarDays: 10,
  reconciliation: 'DAILY_TARGET',
  criticalEscalation: 'SAME_BUSINESS_DAY_TARGET',
  businessCalendar: null,
  retention: null,
});

export function informationDeadline(now: Date) {
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + refundTargets.informationCalendarDays);
  return due;
}

/** Never invent working days or holidays when an operational calendar is unknown. */
export function refundTiming(row: { informationDueAt?: Date | string | null }, now = new Date()) {
  return {
    ...refundTargets,
    decisionDueAt: null,
    updateDueAt: null,
    informationDueAt: row.informationDueAt ?? null,
    informationOverdue: !!row.informationDueAt && new Date(row.informationDueAt) <= now,
    automaticRejection: false,
  };
}
