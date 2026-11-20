// Sample data with the shapes of the backend responses (ACM-Backend checkinService.ts:
// verifyBadge, getInRoomCheckins). Used by the desktop browser and by the local
// "simulate a scan" box (M8). No network.
//
// `createFixtureFetch()` is a fake `fetch` that answers the API routes of the app with these
// shapes, so that the real code (api.js, photos.js, sse.js, the screens) runs in a desktop
// browser without a backend (`npm run dev`, see app.js for the switch).

import { slotOverview } from './schedule.js';

const timing = {
  timezone: 'Indian/Antananarivo',
  serverTime: '2026-11-20T07:30:00.000Z',
};

const todaySlots = [
  { start: '08:00', end: '12:00', state: 'current' },
  { start: '14:00', end: '17:00', state: 'later' },
];

/** A badge of the fixtures: the QR text is `JSON.stringify(fixtureBadge)`. */
export const FIXTURE_SIGNATURE = '0123456789abcdef'.repeat(4);
export const fixtureBadge = Object.freeze({ registrationNumber: 42, signature: FIXTURE_SIGNATURE });

// No photo in the simulated results: the "simulate a scan" box makes no network call.
const member = {
  registrationNumber: 42,
  firstName: 'Hery',
  lastName: 'Rakoto',
  photoUrl: null,
};

/** `data` of POST /api/checkins/verify, one per status. */
export const verifyResults = {
  CHECKED_IN: {
    status: 'CHECKED_IN',
    member,
    slot: { day: 'friday', start: '08:00', end: '12:00' },
    checkIn: { id: 1201, time: '2026-11-20T05:12:00.000Z', activity: 'Robotics' },
    nextSlot: { day: 'friday', start: '14:00', end: '17:00' },
    todaySlots,
    closedToday: false,
    now: { day: 'friday', time: '10:30' },
    ...timing,
  },
  NOT_CHECKED_IN: {
    status: 'NOT_CHECKED_IN',
    member,
    slot: { day: 'friday', start: '08:00', end: '12:00' },
    checkIn: null,
    nextSlot: { day: 'friday', start: '14:00', end: '17:00' },
    todaySlots,
    closedToday: false,
    now: { day: 'friday', time: '10:30' },
    ...timing,
  },
  NO_SLOT: {
    status: 'NO_SLOT',
    member,
    slot: null,
    checkIn: null,
    nextSlot: { day: 'friday', start: '14:00', end: '17:00' },
    todaySlots: [
      { start: '08:00', end: '12:00', state: 'ended' },
      { start: '14:00', end: '17:00', state: 'next' },
    ],
    closedToday: false,
    now: { day: 'friday', time: '12:45' },
    ...timing,
    serverTime: '2026-11-20T09:45:00.000Z',
  },
  // The backend keeps the schedule fields on INVALID_BADGE; member, slot, checkIn are null.
  INVALID_BADGE: {
    status: 'INVALID_BADGE',
    member: null,
    slot: null,
    checkIn: null,
    nextSlot: { day: 'friday', start: '14:00', end: '17:00' },
    todaySlots,
    closedToday: false,
    now: { day: 'friday', time: '10:30' },
    ...timing,
  },
};

/** Params of the 4e "Cannot verify" result: no server answer, only the scanned badge. */
export const cannotVerify = { error: true, kind: 'network', badge: fixtureBadge };

/**
 * The buttons of the "Local build only · simulate a scan" box (scanner, local build only):
 * label and the screen they open, without a network call.
 */
export const simulatedScans = [
  { label: 'Checked in', screen: 'result', params: { result: verifyResults.CHECKED_IN, badge: fixtureBadge } },
  { label: 'Not checked', screen: 'result', params: { result: verifyResults.NOT_CHECKED_IN, badge: fixtureBadge } },
  { label: 'No slot', screen: 'result', params: { result: verifyResults.NO_SLOT, badge: fixtureBadge } },
  { label: 'Invalid', screen: 'result', params: { result: verifyResults.INVALID_BADGE, badge: fixtureBadge } },
  { label: 'Offline', screen: 'result', params: cannotVerify },
  { label: 'Intern login', screen: 'accessDenied', params: { user: { username: 'intern', role: 'intern' }, simulated: true } },
];

/** One reduced item of GET /api/checkins/in-room (a user with checkins.verify only). */
function inRoomItem(id, registrationNumber, firstName, lastName, activity, checkInTime) {
  return {
    id,
    registrationNumber,
    activityId: activity.id,
    checkInTime,
    checkOutTime: null,
    visitReason: null,
    Member: { registrationNumber, firstName, lastName, profileImage: null },
    Activity: { id: activity.id, name: activity.name },
  };
}

const robotics = { id: 3, name: 'Robotics' };
const coding = { id: 5, name: 'Coding club' };

/** `data` and `pagination` of GET /api/checkins/in-room?limit=20 (one page). */
export const inRoomPage = {
  data: {
    checkins: [
      inRoomItem(1203, 57, 'Fara', 'Andriamanana', coding, '2026-11-20T06:40:00.000Z'),
      inRoomItem(1202, 18, 'Tiana', null, robotics, '2026-11-20T05:58:00.000Z'),
      inRoomItem(1201, 42, 'Hery', 'Rakoto', robotics, '2026-11-20T05:12:00.000Z'),
    ],
    slot: { day: 'friday', start: '08:00', end: '12:00' },
    ...timing,
  },
  pagination: { limit: 20, total: 3, hasMore: false, nextBefore: null },
};

// ---------------------------------------------------------------- Fake API for the browser

const FIXTURE_TOKEN = 'fixture-token';
const FIXTURE_ZONE = timing.timezone;

const FIXTURE_SCHEDULE = (() => {
  const weekday = () => ({ open: true, slots: [{ start: '08:00', end: '12:00' }, { start: '15:00', end: '18:00' }] });
  return {
    monday: weekday(), tuesday: weekday(), wednesday: weekday(), thursday: weekday(),
    friday: weekday(), saturday: { open: true, slots: [{ start: '09:00', end: '16:00' }] }, sunday: weekday(),
  };
})();

const FIRST_NAMES = ['Hery', 'Fara', 'Tiana', 'Mamy', 'Voahirana', 'Andry', 'Lalao', 'Njaka', 'Soa', 'Rivo'];
const LAST_NAMES = ['Rakoto', 'Andriamanana', null, 'Rasoanaivo', 'Randria', 'Rabe', 'Razafy', 'Ravelo'];
const ACTIVITIES = [{ id: 3, name: 'Robotics' }, { id: 5, name: 'Coding club' }, { id: 7, name: 'English Club' }, { id: 9, name: 'Library' }];

/** A full in-room row; every third member has no photo (default avatar). */
function fixtureRow(id, index, checkInTime) {
  const registrationNumber = 100 + index;
  const activity = ACTIVITIES[index % ACTIVITIES.length];
  return {
    id,
    registrationNumber,
    activityId: activity.id,
    checkInTime: new Date(checkInTime).toISOString(),
    checkOutTime: null,
    visitReason: null,
    Member: {
      registrationNumber,
      firstName: FIRST_NAMES[index % FIRST_NAMES.length],
      lastName: LAST_NAMES[index % LAST_NAMES.length],
      profileImage: index % 3 === 2 ? null : `members/fixture-${registrationNumber}.svg`,
    },
    Activity: activity,
  };
}

function avatarSvg(seed) {
  const hue = (seed * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="hsl(${hue},45%,78%)"/>` +
    `<circle cx="48" cy="38" r="17" fill="hsl(${hue},35%,45%)"/><path d="M16 92c0-18 14-30 32-30s32 12 32 30" fill="hsl(${hue},35%,45%)"/></svg>`;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

/**
 * A fake `fetch` for the desktop browser.
 * Login: any username and password; `intern` gives a role without checkins.verify, `wrong`
 * as password gives 401. In-room: `total` check-ins of today, 20 per page, cursor on the id.
 * SSE: a new check-in every `liveEveryMs`.
 */
export function createFixtureFetch({ total = 47, latencyMs = 500, liveEveryMs = 20000 } = {}) {
  const listeners = new Set();
  const now = Date.now();
  let nextIndex = total;
  // Newest first: ids 1000+total … 1001, one check-in every 4 minutes.
  const rows = [];
  for (let i = 0; i < total; i++) rows.push(fixtureRow(1001 + i, i, now - (total - i) * 4 * 60000));

  setInterval(() => {
    const row = fixtureRow(1001 + nextIndex, nextIndex, Date.now());
    nextIndex++;
    rows.push(row);
    for (const send of listeners) send(row);
  }, liveEveryMs);

  const user = (role) => ({
    id: 1, username: role, email: `${role}@fixture.local`, role, active: true,
    permissions: { 'checkins.verify': role !== 'intern', 'checkins.create': true },
  });

  return async function fixtureFetch(url, init = {}) {
    const { pathname, searchParams } = new URL(url, 'http://fixture.local');
    const method = (init.method || 'GET').toUpperCase();
    const auth = (init.headers && init.headers.Authorization) || '';
    const authorized = auth === `Bearer ${FIXTURE_TOKEN}` || searchParams.get('auth') === FIXTURE_TOKEN;
    await delay(pathname === '/api/sse/checkins' ? 50 : latencyMs, init.signal);

    if (method === 'POST' && pathname === '/api/auth/login') {
      const { username = '', password = '' } = JSON.parse(init.body || '{}');
      if (!username || !password) return json(422, { success: false, message: 'Validation failed', data: null });
      if (password === 'wrong') return json(401, { success: false, message: 'Invalid password', data: null });
      return json(200, { success: true, message: 'User connected successfully', data: { token: FIXTURE_TOKEN, user: user(username === 'intern' ? 'intern' : 'volunteer') } });
    }
    if (!authorized) return json(401, { success: false, message: 'Invalid or expired token', data: null });

    if (pathname === '/api/auth/token') {
      return json(200, { success: true, message: 'Token valid', data: user('volunteer') });
    }
    if (pathname === '/api/checkins/schedule') {
      return json(200, { success: true, message: 'Check-in schedule', data: { timezone: FIXTURE_ZONE, schedule: FIXTURE_SCHEDULE } });
    }
    if (pathname === '/api/checkins/in-room') {
      const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 20));
      const before = Number(searchParams.get('before')) || Infinity;
      const all = [...rows].sort((a, b) => b.id - a.id);
      const after = all.filter((row) => row.id < before);
      const page = after.slice(0, limit);
      const hasMore = after.length > limit;
      const serverNow = new Date();
      return json(200, {
        success: true,
        message: 'Members in room',
        data: { checkins: page, slot: slotOverview(serverNow, FIXTURE_SCHEDULE, FIXTURE_ZONE).slot, timezone: FIXTURE_ZONE, serverTime: serverNow.toISOString() },
        pagination: { limit, total: all.length, hasMore, nextBefore: hasMore ? page[page.length - 1].id : null },
      });
    }
    if (pathname === '/api/sse/checkins') {
      const encoder = new TextEncoder();
      let send;
      let beat;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));
          send = (row) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'new-checkin', data: row })}\n\n`));
          listeners.add(send);
          beat = setInterval(() => controller.enqueue(encoder.encode(':heartbeat\n\n')), 30000);
          if (init.signal) init.signal.addEventListener('abort', () => {
            listeners.delete(send);
            clearInterval(beat);
            try { controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* closed */ }
          }, { once: true });
        },
        cancel() {
          listeners.delete(send);
          clearInterval(beat);
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (method === 'POST' && pathname === '/api/checkins/verify') {
      // 42 → CHECKED_IN, 18 → NOT_CHECKED_IN, 57 → NO_SLOT, with the fixture signature;
      // any other badge → INVALID_BADGE. Number 99 → 500 (to try Retry on 4e).
      const { registrationNumber, signature } = JSON.parse(init.body || '{}');
      if (!Number.isInteger(registrationNumber) || typeof signature !== 'string' || !signature) {
        return json(422, { success: false, message: 'Validation failed', data: null });
      }
      if (registrationNumber === 99) return json(500, { success: false, message: 'Internal server error', data: null });
      const status = { 42: 'CHECKED_IN', 18: 'NOT_CHECKED_IN', 57: 'NO_SLOT' }[registrationNumber];
      const base = status && signature === FIXTURE_SIGNATURE ? verifyResults[status] : verifyResults.INVALID_BADGE;
      const data = base.member
        ? { ...base, member: { ...base.member, registrationNumber, photoUrl: `/uploads/members/fixture-${registrationNumber}.svg` } }
        : base;
      return json(200, { success: true, message: 'Badge verified', data });
    }
    const photo = pathname.match(/^\/uploads\/members\/fixture-(\d+)\.svg$/);
    if (photo) {
      return new Response(avatarSvg(Number(photo[1])), { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
    }
    return json(404, { success: false, message: 'Not found', data: null });
  };
}
