// Check-in schedule, current slot and server clock.
//
// The slot rules are those of the server (ACM-Backend src/utils/checkinUtils.ts): a slot
// includes its start and excludes its end; the day and the `HH:mm` time come from the time zone
// of the app, never from the phone zone. The functions above "State" are pure.

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const formats = new Map();

function zoneFormat(timeZone) {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** The day of the week (`tuesday`) and the `HH:mm` time of an instant in a time zone. */
export function zoneDayAndTime(date, timeZone) {
  const parts = zoneFormat(timeZone).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  const day = part('weekday').toLowerCase();
  if (!DAYS.includes(day)) throw new Error(`Unknown day: ${part('weekday')}`);
  return { day, time: `${part('hour')}:${part('minute')}` };
}

function openSlots(schedule, day) {
  const value = schedule && schedule[day];
  if (!value || !value.open || !Array.isArray(value.slots)) return [];
  return [...value.slots].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * The slots of the day of `date` and where `date` is among them: the same result as
 * `getSlotOverview` of the server, without the slot id.
 * @returns {{ day, time, closedToday, slot, todaySlots, nextSlot }}
 */
export function slotOverview(date, schedule, timeZone) {
  const { day, time } = zoneDayAndTime(date, timeZone);
  const slots = openSlots(schedule, day);
  const current = slots.find((item) => item.start <= time && time < item.end);
  const nextToday = slots.find((item) => item.start > time);

  const todaySlots = slots.map((item) => {
    let state = 'later';
    if (item === current) state = 'current';
    else if (item.end <= time) state = 'ended';
    else if (item === nextToday) state = 'next';
    return { start: item.start, end: item.end, state };
  });

  let nextSlot = nextToday ? { day, start: nextToday.start, end: nextToday.end } : null;
  const index = DAYS.indexOf(day);
  for (let offset = 1; !nextSlot && offset <= DAYS.length; offset++) {
    const nextDay = DAYS[(index + offset) % DAYS.length];
    const [first] = openSlots(schedule, nextDay);
    if (first) nextSlot = { day: nextDay, start: first.start, end: first.end };
  }

  return {
    day,
    time,
    closedToday: slots.length === 0,
    slot: current ? { day, start: current.start, end: current.end } : null,
    todaySlots,
    nextSlot,
  };
}

/** The slot that contains `date` (`{ day, start, end }`), or null. */
export function currentSlot(date, schedule, timeZone) {
  return slotOverview(date, schedule, timeZone).slot;
}

// ---------------------------------------------------------------- State

let offsetMs = 0;
let cache = null; // { timezone, schedule }

/**
 * Each response that carries `serverTime` sets the clock offset, so a wrong phone clock does
 * not change the slot (plan M6, test S12).
 */
export function setServerTime(serverTime, localNow = Date.now()) {
  const server = new Date(serverTime).getTime();
  if (Number.isFinite(server)) offsetMs = server - localNow;
}

/** The current instant of the server clock. */
export function now(localNow = Date.now()) {
  return new Date(localNow + offsetMs);
}

export function clockOffset() {
  return offsetMs;
}

/** The last schedule loaded (`{ timezone, schedule }`), or null. */
export function cached() {
  return cache;
}

/** `GET /api/checkins/schedule` → `{ timezone, schedule }`, kept for the session. */
export async function load(api) {
  const { data } = await api.request('GET', '/api/checkins/schedule');
  if (!data || typeof data.timezone !== 'string' || !data.schedule) {
    throw new Error('schedule: unexpected response');
  }
  cache = { timezone: data.timezone, schedule: data.schedule };
  return cache;
}

/** Forgets the schedule (sign-out). The clock offset stays: it is not tied to an account. */
export function reset() {
  cache = null;
}
