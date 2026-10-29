// RFC 5545: escape TEXT and fold by UTF-8 octets, without splitting a code point.
const text = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
function fold(value: string) {
  let line = '',
    result = '';
  for (const character of value) {
    if (Buffer.byteLength(line + character, 'utf8') > 75) {
      result += line + '\r\n';
      line = ' ';
    }
    line += character;
  }
  return result + line;
}
const date = (value: Date) =>
  value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
export function appointmentCalendar(
  a: { id: string; startsAt: Date; updatedAt: Date; location: string },
  title: string,
  description: string,
) {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AutoVeri//Appointments//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${a.id}@appointments.autoveri.invalid`,
      `DTSTAMP:${date(a.updatedAt)}`,
      `DTSTART:${date(a.startsAt)}`,
      `SUMMARY:${text(title)}`,
      `DESCRIPTION:${text(description)}`,
      `LOCATION:${text(a.location)}`,
      'STATUS:CONFIRMED',
      'CLASS:PRIVATE',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(fold)
      .join('\r\n') + '\r\n'
  );
}
