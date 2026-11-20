// Pure helpers of the screens (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noSlotSubtitle } from '../src/js/screens/result.js';
import { slotCardText } from '../src/js/screens/scanner.js';
import { roleLabel } from '../src/js/screens/accessDenied.js';

const slots = (...states) => states.map((state, i) => ({ start: `0${8 + i * 4}:00`.slice(-5), end: '23:00', state }));

test('4c subtitle: "<day time> · between two slots"', () => {
  assert.equal(
    noSlotSubtitle({ now: { day: 'friday', time: '12:40' }, closedToday: false, todaySlots: slots('ended', 'next') }),
    'Friday 12:40 · between two slots'
  );
});

test('4c subtitle: closed day', () => {
  assert.equal(
    noSlotSubtitle({ now: { day: 'sunday', time: '10:00' }, closedToday: true, todaySlots: [] }),
    'Sunday 10:00 · closed today'
  );
});

test('4c subtitle: before the first slot and after the last slot', () => {
  assert.equal(
    noSlotSubtitle({ now: { day: 'friday', time: '07:00' }, closedToday: false, todaySlots: slots('next', 'later') }),
    "Friday 07:00 · before today's first slot"
  );
  assert.equal(
    noSlotSubtitle({ now: { day: 'friday', time: '19:00' }, closedToday: false, todaySlots: slots('ended', 'ended') }),
    "Friday 19:00 · after today's last slot"
  );
});

test('scanner slot card: open slot', () => {
  assert.deepEqual(
    slotCardText({ slot: { day: 'friday', start: '08:00', end: '12:00' }, closedToday: false, nextSlot: null }),
    { open: true, label: 'Current slot · open', value: 'Friday 08:00 – 12:00' }
  );
});

test('scanner slot card: between slots, closed day, nothing planned', () => {
  const next = { day: 'friday', start: '15:00', end: '18:00' };
  assert.deepEqual(slotCardText({ slot: null, closedToday: false, nextSlot: next }), {
    open: false,
    label: 'No slot now · next slot',
    value: 'Friday 15:00 – 18:00',
  });
  assert.deepEqual(slotCardText({ slot: null, closedToday: true, nextSlot: { ...next, day: 'monday' } }), {
    open: false,
    label: 'Closed today · next slot',
    value: 'Monday 15:00 – 18:00',
  });
  assert.deepEqual(slotCardText({ slot: null, closedToday: true, nextSlot: null }), {
    open: false,
    label: 'Closed today',
    value: 'No slot planned',
  });
});

test('1b role chip: intern → Intern', () => {
  assert.equal(roleLabel('intern'), 'Intern');
  assert.equal(roleLabel(''), '');
  assert.equal(roleLabel(undefined), '');
});
