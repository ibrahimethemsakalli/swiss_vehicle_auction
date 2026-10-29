import type { auditLocalLedger } from './local-proxy-ledger';

export type LedgerReport = ReturnType<typeof auditLocalLedger> & { checkedAt: string };
export type LedgerFilters = { from: string; to: string; onlyIssues: boolean };

// UTC calendar dates, inclusive at both ends; empty bounds mean all dates.
export function validLedgerDates({ from, to }: LedgerFilters) {
  const valid = (s: string) => {
    if (!s) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000')) return false;
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  return valid(from) && valid(to) && (!from || !to || from <= to);
}

export function filterLedger(report: LedgerReport, filters: LedgerFilters) {
  if (!validLedgerDates(filters)) throw Error('INVALID_LEDGER_DATES');
  const issues = new Set(report.issues.map((i) => i.auctionId));
  const entries = report.entries.filter((e) => {
    const day = e.at.slice(0, 10);
    return (
      (!filters.from || day >= filters.from) &&
      (!filters.to || day <= filters.to) &&
      (!filters.onlyIssues || issues.has(e.auctionId))
    );
  });
  const sum = (kind: 'CAPTURE' | 'REFUND') =>
    entries
      .filter((e) => e.kind === kind && e.currency === 'CHF')
      .reduce((sum, e) => sum + BigInt(e.amountCents), 0n);
  const captured = sum('CAPTURE'),
    refunded = sum('REFUND');
  return {
    entries,
    captureCents: captured.toString(),
    refundCents: refunded.toString(),
    netCents: (captured - refunded).toString(),
    excludedCurrencyCount: entries.filter((e) => e.currency !== 'CHF').length,
  };
}

// Quote every cell, escape quotes, and neutralize spreadsheet formula prefixes,
// including those concealed behind whitespace/control characters. Never emit raw controls.
export function ledgerCsvCell(value: string) {
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export type LedgerCsvLabels = Record<
  | 'title'
  | 'scope'
  | 'checked'
  | 'from'
  | 'to'
  | 'all'
  | 'onlyIssues'
  | 'yes'
  | 'no'
  | 'captured'
  | 'refunded'
  | 'net'
  | 'excluded'
  | 'auction'
  | 'kind'
  | 'amount'
  | 'currency'
  | 'at',
  string
>;

export function ledgerCsv(report: LedgerReport, filters: LedgerFilters, labels: LedgerCsvLabels) {
  const view = filterLedger(report, filters);
  const decimal = (cents: string) => {
    const n = BigInt(cents),
      abs = n < 0n ? -n : n;
    return `${n < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  };
  const rows: string[][] = [
    [labels.title],
    [labels.scope],
    [labels.checked, report.checkedAt],
    [labels.from, filters.from || labels.all],
    [labels.to, filters.to || labels.all],
    [labels.onlyIssues, filters.onlyIssues ? labels.yes : labels.no],
    [labels.captured, decimal(view.captureCents), 'CHF'],
    [labels.refunded, decimal(view.refundCents), 'CHF'],
    [labels.net, decimal(view.netCents), 'CHF'],
    [labels.excluded, String(view.excludedCurrencyCount)],
    [],
    [labels.auction, labels.kind, labels.amount, labels.currency, labels.at],
    ...view.entries.map((e) => [
      e.auctionId,
      e.kind === 'CAPTURE' ? labels.captured : labels.refunded,
      decimal(String(e.amountCents)),
      e.currency,
      e.at,
    ]),
  ];
  // Explicit field allowlist above: no spread of records, private IDs, reasons or limits.
  return '\uFEFF' + rows.map((row) => row.map(ledgerCsvCell).join(',')).join('\r\n') + '\r\n';
}
