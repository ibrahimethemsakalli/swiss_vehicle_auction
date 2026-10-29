import test from 'node:test';
import assert from 'node:assert/strict';
import { addUtcCalendarMonths } from '../src/lib/retention-calendar';
test('UTC calendar arithmetic clamps month end and preserves the time without mutating input',()=>{
  const d=new Date('2023-08-31T23:59:59.123Z');
  assert.equal(addUtcCalendarMonths(d,6)?.toISOString(),'2024-02-29T23:59:59.123Z');
  assert.equal(d.toISOString(),'2023-08-31T23:59:59.123Z');
  assert.equal(addUtcCalendarMonths(new Date('2024-08-31T12:00:00Z'),6)?.toISOString(),'2025-02-28T12:00:00.000Z');
  assert.equal(addUtcCalendarMonths(new Date('2026-03-29T01:30:00Z'),6)?.toISOString(),'2026-09-29T01:30:00.000Z');
});
test('invalid calendar inputs fail closed',()=>{
  assert.equal(addUtcCalendarMonths(new Date('bad'),6),null);
  assert.equal(addUtcCalendarMonths(new Date(),-1),null);
  assert.equal(addUtcCalendarMonths(new Date(),0.5),null);
});
