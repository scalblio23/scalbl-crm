// What the app loaded last time, kept in this browser so the next
// start shows straight away while fresh data loads behind it:
//   - who's logged in (localStorage — tiny, read synchronously)
//   - the /api/bootstrap payload (IndexedDB — can be megabytes)
// Both are per login and wiped on logout. The server still checks
// every request; this only decides what's on screen for the first
// second.
const USER_KEY = "scalbl.session.user";
const DB_NAME = "scalbl-cache";
const STORE = "snapshots";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function getCachedUser() {
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    return u && u.id && u.role ? u : null;
  } catch {
    return null;
  }
}

export function setCachedUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // storage blocked — the app just starts the normal way
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// null when there's nothing (recent enough) saved for this user.
export async function readSnapshot(name, userId) {
  try {
    const saved = await withStore("readonly", (s) => s.get(`${name}:${userId}`));
    if (!saved || Date.now() - saved.at > MAX_AGE_MS) return null;
    return saved.data;
  } catch {
    return null;
  }
}

export async function writeSnapshot(name, userId, data) {
  try {
    await withStore("readwrite", (s) => s.put({ at: Date.now(), data }, `${name}:${userId}`));
  } catch {
    // quota or blocked — next start just loads the normal way
  }
}

// On logout: forget everything saved in this browser.
export async function clearStartupCache() {
  setCachedUser(null);
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("scalbl.csm.snapshot."))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // nothing saved
  }
  try {
    await withStore("readwrite", (s) => s.clear());
  } catch {
    // nothing saved
  }
}
