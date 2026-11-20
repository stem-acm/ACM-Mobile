import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_SLOT_TEXT,
  NO_TIME,
  dayName,
  memberName,
  memberNumber,
  slotLabel,
  timeInZone,
} from '../src/js/format.js';

const ZONE = 'Indian/Antananarivo'; // UTC+3, no daylight saving time

test('memberName: LAST NAME First name', () => {
  assert.equal(memberName({ firstName: 'Hery', lastName: 'Rakoto' }), 'RAKOTO Hery');
  assert.equal(memberName({ firstName: 'Fara', lastName: 'Andriamanana-Be' }), 'ANDRIAMANANA-BE Fara');
});

test('memberName: the last name can be null or empty', () => {
  assert.equal(memberName({ firstName: 'Tiana', lastName: null }), 'Tiana');
  assert.equal(memberName({ firstName: 'Tiana', lastName: '  ' }), 'Tiana');
  assert.equal(memberName(null), '');
});

test('memberNumber', () => {
  assert.equal(memberNumber(42), '#42');
  assert.equal(memberNumber(null), '');
  assert.equal(memberNumber(undefined), '');
});

test('slotLabel: Friday 08:00 – 12:00; null for no slot', () => {
  assert.equal(slotLabel({ day: 'friday', start: '08:00', end: '12:00' }), 'Friday 08:00 – 12:00');
  assert.equal(slotLabel({ start: '15:00', end: '18:00' }), '15:00 – 18:00');
  assert.equal(slotLabel(null), null);
  assert.equal(NO_SLOT_TEXT, 'No check-in slot now');
  assert.equal(dayName('saturday'), 'Saturday');
});

test('timeInZone: 24 h in the time zone of the app, not of the phone', () => {
  assert.equal(timeInZone('2026-11-20T05:12:00.000Z', ZONE), '08:12');
  assert.equal(timeInZone('2026-11-20T10:05:00.000Z', ZONE), '13:05', '24 h, not 1:05 PM');
  assert.equal(timeInZone('2026-11-20T05:12:00.000Z', 'UTC'), '05:12');
  assert.equal(timeInZone('2026-11-20T05:12:00.000Z', 'America/New_York'), '00:12');
  assert.equal(timeInZone(new Date('2026-11-19T21:00:00.000Z'), ZONE), '00:00', 'midnight is 00:00');
});

test('timeInZone: no end time or a bad value gives —', () => {
  assert.equal(NO_TIME, '—');
  assert.equal(timeInZone(null, ZONE), '—');
  assert.equal(timeInZone(undefined, ZONE), '—');
  assert.equal(timeInZone('', ZONE), '—');
  assert.equal(timeInZone('not a date', ZONE), '—');
});

test('timeInZone: an unknown zone falls back to the phone zone instead of failing', () => {
  assert.match(timeInZone('2026-11-20T05:12:00.000Z', 'Mars/Olympus'), /^\d{2}:\d{2}$/);
});
