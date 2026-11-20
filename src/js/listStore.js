// State of the "Checked in now" list (pure, plan M7).
//
// Rows are the items of GET /api/checkins/in-room and of the SSE `new-checkin` events. Newest
// first (highest id first). Cursor pagination: `nextBefore` always comes from the server
// pagination, never from a live row.

/** A check-in is in the room when it has no check-out time or one later than `now`. */
export function isInRoom(row, now) {
  if (!row || row.checkOutTime === null || row.checkOutTime === undefined || row.checkOutTime === '') {
    return true;
  }
  const out = new Date(row.checkOutTime).getTime();
  return Number.isNaN(out) || out > now.getTime();
}

function validRow(row) {
  return row && typeof row === 'object' && Number.isInteger(row.id);
}

export function createListStore() {
  const state = {
    items: [],
    ids: new Set(),
    total: 0,
    nextBefore: null,
    hasMore: false,
    loading: false,
    loaded: false, // page 1 arrived at least once
  };

  /** Index where a row with `id` goes, newest (highest id) first. */
  function positionOf(id) {
    const index = state.items.findIndex((item) => item.id < id);
    return index === -1 ? state.items.length : index;
  }

  return {
    state,

    /** Empties the list (before page 1 of a refresh is added). */
    reset() {
      state.items = [];
      state.ids = new Set();
      state.total = 0;
      state.nextBefore = null;
      state.hasMore = false;
      state.loaded = false;
    },

    /**
     * Adds a page. Rows already present (a live row can come back in a page) are skipped.
     * `total`, `hasMore` and `nextBefore` come from the server pagination.
     * @returns {number} the number of rows added
     */
    addPage(rows, pagination) {
      let added = 0;
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!validRow(row) || state.ids.has(row.id)) continue;
        state.items.splice(positionOf(row.id), 0, row);
        state.ids.add(row.id);
        added++;
      }
      const page = pagination || {};
      if (Number.isInteger(page.total) && page.total >= 0) state.total = page.total;
      state.nextBefore = Number.isInteger(page.nextBefore) ? page.nextBefore : null;
      state.hasMore = Boolean(page.hasMore) && state.nextBefore !== null;
      state.total = Math.max(state.total, state.hasMore ? 0 : state.items.length);
      state.loaded = true;
      return added;
    },

    /**
     * A live check-in: added at its place (the top for a new one) when its id is new and it is
     * in the room; `total` goes up by one.
     * @returns {boolean} true when the row was added
     */
    addLive(row, now = new Date()) {
      if (!validRow(row) || state.ids.has(row.id) || !isInRoom(row, now)) return false;
      state.items.splice(positionOf(row.id), 0, row);
      state.ids.add(row.id);
      state.total += 1;
      return true;
    },

    /**
     * Removes the rows whose check-out time is past and lowers `total`.
     * @returns {number[]} the ids removed
     */
    dropExpired(now = new Date()) {
      const removed = [];
      state.items = state.items.filter((row) => {
        if (isInRoom(row, now)) return true;
        removed.push(row.id);
        state.ids.delete(row.id);
        return false;
      });
      state.total = Math.max(0, state.total - removed.length);
      return removed;
    },
  };
}
