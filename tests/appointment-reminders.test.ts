import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appointmentCalendar } from '../src/lib/appointment-calendar';
const fixture = {
  id: '00000000-0000-4000-8000-000000000025',
  startsAt: new Date('2026-10-25T01:30:00Z'),
  updatedAt: new Date('2026-10-24T10:00:00Z'),
  location: 'Zürich, Bahnhof; Nord\\Süd\r\nBEGIN:VALARM',
};
test('calendar escapes untrusted text and folds UTF-8 without injecting properties', () => {
  const file = appointmentCalendar(fixture, 'Ä🚗'.repeat(60), 'Private\nmeeting');
  for (const line of file.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = file.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('LOCATION:Zürich\\, Bahnhof\\; Nord\\\\Süd\\nBEGIN:VALARM'));
  assert.equal(file.split('\r\n').filter((l) => l === 'BEGIN:VALARM').length, 0);
  assert.ok(unfolded.includes('SUMMARY:' + 'Ä🚗'.repeat(60)));
  assert.ok(file.endsWith('END:VCALENDAR\r\n'));
  assert.ok(
    !file.includes('DTEND:') && !file.includes('ATTENDEE:') && !file.includes('ORGANIZER:'),
  );
});
test('calendar keeps the exact UTC instant across Swiss daylight saving transitions', () => {
  for (const value of [
    '2026-03-29T00:30:00Z',
    '2026-03-29T01:30:00Z',
    '2026-10-25T00:30:00Z',
    '2026-10-25T01:30:00Z',
  ]) {
    const file = appointmentCalendar(
      { ...fixture, startsAt: new Date(value) },
      'Meeting',
      'Details',
    );
    assert.ok(file.includes('DTSTART:' + value.replace(/[-:]/g, '')));
  }
});
test('new reminder and calendar messages exist in four languages', () => {
  for (const lang of ['de', 'fr', 'it', 'en']) {
    const messages = JSON.parse(readFileSync(`src/messages/${lang}.json`, 'utf8'));
    for (const key of [
      'chatCalendarDownload',
      'chatCalendarTitle',
      'chatCalendarNote',
      'chatReminderNote',
      'noticeChatReminder',
    ])
      assert.ok(messages[key]?.length > 10);
  }
});
