// The cases of ACM-Backend tests/checkinUtils.test.ts: the app must find the same slot as the
// server for the same instant, schedule and time zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as schedule from '../src/js/schedule.js';

const { currentSlot, slotOverview, zoneDayAndTime } = schedule;

const weekday = () => ({ open: true, slots: [{ start: '08:00', end: '12:00' }, { start: '15:00', end: '18:00' }] });
/** DEFAULT_CHECKIN_SCHEDULE of the backend. */
const DEFAULT = {
  monday: weekday(), tuesday: weekday(), wednesday: weekday(), thursday: weekday(), friday: weekday(),
  saturday: { open: true, slots: [{ start: '09:00', end: '16:00' }] },
  sunday: weekday(),
};
const ZONE = 'Indian/Antananarivo'; // Mahajanga, UTC+3. 2026-11-10 is a Tuesday.
const at = (iso) => new Date(iso);
const slotId = (date, value = DEFAULT, zone = ZONE) => {
  const slot = currentSlot(date, value, zone);
  return slot ? `${slot.day}-${slot.start}` : null;
};

test('a Tuesday at 08:00 in Mahajanga is in the slot tuesday-08:00', () => {
  assert.equal(slotId(at('2026-11-10T05:00:00Z')), 'tuesday-08:00');
  assert.equal(slotId(at('2026-11-10T08:59:00Z')), 'tuesday-08:00');
  assert.deepEqual(currentSlot(at('2026-11-10T05:00:00Z'), DEFAULT, ZONE), { day: 'tuesday', start: '08:00', end: '12:00' });
});

test('the end of a slot is excluded, the start included', () => {
  assert.equal(slotId(at('2026-11-10T09:00:00Z')), null);
  assert.equal(slotId(at('2026-11-10T04:59:00Z')), null);
  assert.equal(slotId(at('2026-11-10T05:00:00Z')), 'tuesday-08:00');
});

test('the afternoon slot and the Saturday slot', () => {
  assert.equal(slotId(at('2026-11-10T12:00:00Z')), 'tuesday-15:00');
  assert.equal(slotId(at('2026-11-14T07:00:00Z')), 'saturday-09:00');
});

test('the day comes from the time in the zone, not from UTC', () => {
  assert.deepEqual(zoneDayAndTime(at('2026-11-09T21:30:00Z'), ZONE), { day: 'tuesday', time: '00:30' });
  assert.deepEqual(zoneDayAndTime(at('2026-11-15T20:59:00Z'), ZONE), { day: 'sunday', time: '23:59' });
});

test('a closed day has no slot', () => {
  const custom = structuredClone(DEFAULT);
  custom.sunday = { open: false, slots: [] };
  assert.equal(slotId(at('2026-11-15T07:00:00Z'), custom), null);
  const result = slotOverview(at('2026-11-15T07:00:00Z'), custom, ZONE);
  assert.equal(result.closedToday, true);
  assert.deepEqual(result.nextSlot, { day: 'monday', start: '08:00', end: '12:00' });
});

test('the same instant gives another slot in another time zone', () => {
  assert.equal(slotId(at('2026-11-10T06:00:00Z')), 'tuesday-08:00');
  assert.equal(slotId(at('2026-11-10T06:00:00Z'), DEFAULT, 'UTC'), null);
  assert.equal(slotId(at('2026-11-10T13:00:00Z')), 'tuesday-15:00');
  assert.equal(slotId(at('2026-11-10T09:00:00Z'), DEFAULT, 'UTC'), 'tuesday-08:00');
});

test('the day of a zone west of UTC can be the day before', () => {
  assert.deepEqual(zoneDayAndTime(at('2026-11-10T02:00:00Z'), 'America/New_York'), { day: 'monday', time: '21:00' });
});

test('overview inside a slot: current, then next', () => {
  assert.deepEqual(slotOverview(at('2026-11-10T06:00:00Z'), DEFAULT, ZONE), {
    day: 'tuesday',
    time: '09:00',
    closedToday: false,
    slot: { day: 'tuesday', start: '08:00', end: '12:00' },
    todaySlots: [
      { start: '08:00', end: '12:00', state: 'current' },
      { start: '15:00', end: '18:00', state: 'next' },
    ],
    nextSlot: { day: 'tuesday', start: '15:00', end: '18:00' },
  });
});

test('overview exactly at the end of a slot: ended, no current slot', () => {
  const result = slotOverview(at('2026-11-10T09:00:00Z'), DEFAULT, ZONE);
  assert.equal(result.slot, null);
  assert.deepEqual(result.todaySlots.map((s) => s.state), ['ended', 'next']);
});

test('overview before the first slot and after the last one', () => {
  assert.deepEqual(slotOverview(at('2026-11-10T04:00:00Z'), DEFAULT, ZONE).todaySlots.map((s) => s.state), ['next', 'later']);
  const late = slotOverview(at('2026-11-10T15:30:00Z'), DEFAULT, ZONE);
  assert.deepEqual(late.todaySlots.map((s) => s.state), ['ended', 'ended']);
  assert.deepEqual(late.nextSlot, { day: 'wednesday', start: '08:00', end: '12:00' });
  assert.deepEqual(slotOverview(at('2026-11-13T16:00:00Z'), DEFAULT, ZONE).nextSlot, { day: 'saturday', start: '09:00', end: '16:00' });
});

test('all days closed: no slot and no next slot', () => {
  const closed = Object.fromEntries(Object.keys(DEFAULT).map((day) => [day, { open: false, slots: [] }]));
  const result = slotOverview(at('2026-11-10T06:00:00Z'), closed, ZONE);
  assert.equal(result.slot, null);
  assert.equal(result.nextSlot, null);
  assert.equal(result.closedToday, true);
});

test('unsorted slots are sorted by start time', () => {
  const custom = structuredClone(DEFAULT);
  custom.tuesday.slots = [{ start: '15:00', end: '18:00' }, { start: '08:00', end: '12:00' }];
  assert.deepEqual(slotOverview(at('2026-11-10T06:00:00Z'), custom, ZONE).todaySlots.map((s) => s.start), ['08:00', '15:00']);
});

test('the server clock offset corrects a wrong phone clock', () => {
  const phone = Date.parse('2026-11-10T04:00:00Z'); // the phone is 2 h late
  schedule.setServerTime('2026-11-10T06:00:00.000Z', phone);
  assert.equal(schedule.clockOffset(), 2 * 3600 * 1000);
  const serverNow = schedule.now(phone + 60000);
  assert.equal(serverNow.toISOString(), '2026-11-10T06:01:00.000Z');
  assert.equal(slotId(serverNow), 'tuesday-08:00');
  schedule.setServerTime('not a date', phone);
  assert.equal(schedule.clockOffset(), 2 * 3600 * 1000, 'a bad serverTime is ignored');
  schedule.setServerTime(new Date(phone).toISOString(), phone);
  assert.equal(schedule.clockOffset(), 0);
});

test('load reads GET /api/checkins/schedule and keeps it until reset', async () => {
  const calls = [];
  const api = {
    request: async (method, path) => {
      calls.push(`${method} ${path}`);
      return { data: { timezone: ZONE, schedule: DEFAULT } };
    },
  };
  const loaded = await schedule.load(api);
  assert.deepEqual(calls, ['GET /api/checkins/schedule']);
  assert.equal(loaded.timezone, ZONE);
  assert.equal(schedule.cached(), loaded);
  schedule.reset();
  assert.equal(schedule.cached(), null);
  await assert.rejects(schedule.load({ request: async () => ({ data: null }) }), /unexpected/);
});
