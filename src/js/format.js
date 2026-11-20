// Names, numbers, slot labels and times (pure). Times are shown in the time zone of the app
// (sent by the server), never in the zone of the phone. 24 h format (plan Q10).

/** Text of the header when no slot is open now (plan Q1). */
export const NO_SLOT_TEXT = 'No check-in slot now';

/** Text for a missing end time. */
export const NO_TIME = '—';

/** `LAST NAME First name`; the last name can be null (ACM-Backend db/schema.ts). */
export function memberName(member) {
  if (!member) return '';
  const last = typeof member.lastName === 'string' ? member.lastName.trim().toUpperCase() : '';
  const first = typeof member.firstName === 'string' ? member.firstName.trim() : '';
  return [last, first].filter(Boolean).join(' ');
}

/** `#42`. */
export function memberNumber(registrationNumber) {
  return registrationNumber === null || registrationNumber === undefined
    ? ''
    : `#${registrationNumber}`;
}

/** `friday` → `Friday`. */
export function dayName(day) {
  if (typeof day !== 'string' || !day) return '';
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/** `{ day: 'friday', start: '08:00', end: '12:00' }` → `Friday 08:00 – 12:00`; null → null. */
export function slotLabel(slot) {
  if (!slot) return null;
  const hours = `${slot.start} – ${slot.end}`;
  return slot.day ? `${dayName(slot.day)} ${hours}` : hours;
}

const timeFormats = new Map();

function timeFormat(timeZone) {
  const key = timeZone || '';
  let format = timeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      ...(timeZone ? { timeZone } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormats.set(key, format);
  }
  return format;
}

/**
 * `HH:mm` of an instant (ISO text, number or Date) in `timeZone`; `—` when empty or invalid.
 * Without a zone (not loaded yet) the phone zone is used.
 */
export function timeInZone(value, timeZone) {
  if (value === null || value === undefined || value === '') return NO_TIME;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NO_TIME;
  try {
    return timeFormat(timeZone).format(date);
  } catch {
    // Unknown zone name: fall back to the phone zone rather than show nothing.
    return timeFormat(undefined).format(date);
  }
}
