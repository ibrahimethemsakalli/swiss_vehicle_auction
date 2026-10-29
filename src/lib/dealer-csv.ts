import { vehicleInput } from './vehicles';
import { draftPayload } from './listing-drafts';
import { csvColumns } from './dealer-import-format';
export { dealerTemplate } from './dealer-import-format';
export type ImportIssue = {
  row: number;
  field: string;
  code: 'required' | 'invalid' | 'duplicate' | 'formula';
};
// Small, bounded RFC-style parser: quoted separators/newlines and escaped quotes are supported.
export function parseDealerCsv(text: string) {
  if (Buffer.byteLength(text, 'utf8') > 256000) throw Error('CSV_LIMIT');
  if (/[\u0000\uFFFD]/.test(text)) throw Error('CSV_FORMAT');
  const input = text.replace(/^\uFEFF/, '');
  const headerLine = input.split(/\r?\n/, 1)[0];
  const separator = headerLine.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
    closed = false;
    if (row.length > csvColumns.length) throw Error('CSV_FORMAT');
  };
  const pushRow = () => {
    pushCell();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > 51) throw Error('CSV_LIMIT');
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw Error('CSV_FORMAT');
      quoted = true;
    } else if (c === separator) pushCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      pushRow();
    } else {
      if (closed && c.trim()) throw Error('CSV_FORMAT');
      if (!closed) cell += c;
    }
    if (cell.length > 5000) throw Error('CSV_LIMIT');
  }
  if (quoted) throw Error('CSV_FORMAT');
  if (cell || row.length || closed) pushRow();
  const headers = rows.shift();
  if (
    !headers ||
    !headers.includes('make') ||
    !headers.includes('model') ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !csvColumns.includes(h as (typeof csvColumns)[number])) ||
    !rows.length
  )
    throw Error('CSV_FORMAT');
  const seen = new Set<string>();
  return rows.map((cells, index) => {
    const issues: ImportIssue[] = [];
    const values: Record<string, string> = {};
    const rowNumber = index + 2;
    if (cells.length !== headers.length)
      issues.push({ row: rowNumber, field: 'CSV', code: 'invalid' });
    headers.forEach((h, i) => {
      values[h] = cells[i] ?? '';
    });
    for (const key of ['make', 'model'])
      if (!values[key]) issues.push({ row: rowNumber, field: key, code: 'required' });
    for (const [key, value] of Object.entries(values)) {
      if (!value) continue;
      if (/^[=+@-]/.test(value)) {
        issues.push({ row: rowNumber, field: key, code: 'formula' });
        continue;
      }
      const numeric = ['modelYear', 'mileage'].includes(key);
      const candidate = numeric ? (/^\d+$/.test(value) ? Number(value) : NaN) : value;
      const schema = vehicleInput.shape[key as keyof typeof vehicleInput.shape];
      if (!schema || !schema.safeParse(candidate).success)
        issues.push({ row: rowNumber, field: key, code: 'invalid' });
    }
    if (values.startPrice && Number(values.startPrice) <= 0)
      issues.push({ row: rowNumber, field: 'startPrice', code: 'invalid' });
    if (values.buyNowPrice && Number(values.buyNowPrice) <= 0)
      issues.push({ row: rowNumber, field: 'buyNowPrice', code: 'invalid' });
    if (values.vinChassis) {
      if (seen.has(values.vinChassis))
        issues.push({ row: rowNumber, field: 'vinChassis', code: 'duplicate' });
      seen.add(values.vinChassis);
    }
    const { listingType, fuelType, transmission, ...draft } = values;
    const base = {
      draft: {},
      specs: {},
      equipment: [],
      images: [],
      customMake: true,
      customModel: true,
      registrationYear: '',
      listingType: 'AUCTION_7_DAYS' as const,
    };
    const parsed = draftPayload.safeParse({
      ...base,
      draft: { ...draft, mfkStatus: 'UNKNOWN', mfkDate: '' },
      specs: { ...(fuelType ? { fuelType } : {}), ...(transmission ? { transmission } : {}) },
      registrationYear: values.firstRegistration?.slice(0, 4) ?? '',
      listingType: listingType === 'FIXED_PRICE_OFFERS' ? 'FIXED_PRICE_OFFERS' : 'AUCTION_7_DAYS',
    });
    if (!parsed.success) issues.push({ row: rowNumber, field: 'CSV', code: 'invalid' });
    const payload = parsed.success ? parsed.data : draftPayload.parse(base);
    return { row: rowNumber, make: values.make, model: values.model, issues, payload };
  });
}
