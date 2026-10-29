// Calendar arithmetic only. This helper does not approve a retention policy or delete data.
export function addUtcCalendarMonths(value: Date, months: number): Date | null {
  if (!Number.isFinite(value.getTime()) || !Number.isInteger(months) || months < 0) return null;
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  if (!Number.isFinite(result.getTime())) return null;
  const end = new Date(result);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  result.setUTCDate(Math.min(day, end.getUTCDate()));
  return Number.isFinite(result.getTime()) ? result : null;
}
