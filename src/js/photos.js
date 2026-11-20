// Member photos (plan M5, conflict C12).
//
// `/uploads/*` needs the Bearer token, so an `<img src>` with the API URL does not work. As the
// web (ACM-Frontend member-photo.service.ts), each photo is downloaded with the token and
// shown as a blob URL. Cache by path for the session (at most 150, the oldest is revoked), at
// most 4 downloads at a time. A failure gives the default avatar and is not cached. `clear()`
// revokes every URL at sign-out.

/** Bundled default avatar (no network). */
export const DEFAULT_AVATAR = 'assets/avatar.svg';

/** Files of `uploads` that are the default avatar of the server. */
const DEFAULT_FILES = new Set(['user.png']);

/**
 * The path of a photo under `/uploads/`, or null when there is no photo.
 * The list gives `members/<uuid>.jpg` (Member.profileImage); the verify result gives
 * `/uploads/members/<uuid>.jpg` (member.photoUrl); a full URL of the API is accepted too.
 */
export function normalizePhotoPath(value, baseUrl = '') {
  if (typeof value !== 'string') return null;
  let path = value.trim();
  if (!path) return null;
  if (baseUrl && path.startsWith(baseUrl)) path = path.slice(baseUrl.length);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null; // another origin, blob:, data:
  path = path.replace(/^\/+/, '');
  if (path.startsWith('uploads/')) path = path.slice('uploads/'.length);
  path = path.split(/[?#]/)[0];
  if (!path || DEFAULT_FILES.has(path)) return null;
  if (path.split('/').some((part) => part === '..' || part === '.' || part === '')) return null;
  return path;
}

/**
 * @param {object} options
 * @param {(path: string) => Promise<Blob>} options.fetchBlob  `GET /uploads/<path>` with the token
 * @param {(blob: Blob) => string} [options.createObjectURL]
 * @param {(url: string) => void} [options.revokeObjectURL]
 * @param {number} [options.maxEntries]
 * @param {number} [options.maxConcurrent]
 * @param {string} [options.defaultUrl]
 * @param {string} [options.baseUrl]  to accept full URLs of the API
 */
export function createPhotoCache({
  fetchBlob,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  maxEntries = 150,
  maxConcurrent = 4,
  defaultUrl = DEFAULT_AVATAR,
  baseUrl = '',
}) {
  const cache = new Map(); // path → object URL, oldest first
  const pending = new Map(); // path → Promise<string>
  const queue = [];
  let running = 0;
  let generation = 0;

  function runNext() {
    while (running < maxConcurrent && queue.length) {
      const job = queue.shift();
      running++;
      job.run().finally(() => {
        running--;
        runNext();
      });
    }
  }

  function schedule(task) {
    return new Promise((resolve, reject) => {
      queue.push({ run: () => task().then(resolve, reject), reject });
      runNext();
    });
  }

  function remember(path, url) {
    cache.set(path, url);
    while (cache.size > maxEntries) {
      const [oldestPath, oldestUrl] = cache.entries().next().value;
      cache.delete(oldestPath);
      revokeObjectURL(oldestUrl);
    }
  }

  /** A URL for an `<img src>`: a blob URL, or the default avatar. Never rejects. */
  function load(value) {
    const path = normalizePhotoPath(value, baseUrl);
    if (!path) return Promise.resolve(defaultUrl);
    const hit = cache.get(path);
    if (hit) {
      cache.delete(path); // most recently used goes last
      cache.set(path, hit);
      return Promise.resolve(hit);
    }
    const inFlight = pending.get(path);
    if (inFlight) return inFlight;

    const started = generation;
    const promise = schedule(() => fetchBlob(path))
      .then((blob) => {
        const url = createObjectURL(blob);
        if (started !== generation) {
          // Signed out during the download: the photo must not stay.
          revokeObjectURL(url);
          return defaultUrl;
        }
        remember(path, url);
        return url;
      })
      .catch(() => defaultUrl)
      .finally(() => {
        if (pending.get(path) === promise) pending.delete(path);
      });
    pending.set(path, promise);
    return promise;
  }

  /** Revokes every blob URL and forgets the queue (sign-out). */
  function clear() {
    generation++;
    for (const url of cache.values()) revokeObjectURL(url);
    cache.clear();
    pending.clear();
    for (const job of queue.splice(0)) job.reject(new Error('cleared'));
  }

  return {
    load,
    clear,
    get size() {
      return cache.size;
    },
    get active() {
      return running;
    },
  };
}

// ---------------------------------------------------------------- Shared instance

let shared = null;

export function configurePhotos(options) {
  shared = createPhotoCache(options);
  return shared;
}

export function load(value) {
  return shared ? shared.load(value) : Promise.resolve(DEFAULT_AVATAR);
}

export function clear() {
  if (shared) shared.clear();
}
