// Thin fetch wrapper for the database API. Same base-URL convention
// as twilioDevice.js: empty string = same-origin (/api/...), correct
// for the deployed site; local dev overrides it via
// VITE_CALL_SERVER_URL in .env to point at the Express server on
// :3001 instead.
const API_BASE = import.meta.env.VITE_CALL_SERVER_URL || "";

function unreachableError() {
  return new Error(
    API_BASE
      ? `Can't reach the backend at ${API_BASE}. Is \`npm run server\` running?`
      : "Can't reach the API on this deployment. Check the Vercel Functions logs."
  );
}

// Every error handler here surfaces the server's own `error` string
// when there is one, so a failure reads as its cause ("Twilio returned
// 401") rather than a bare status code.
async function throwForStatus(res) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || `Request failed (${res.status})`);
  err.status = res.status;
  throw err;
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      ...options,
    });
  } catch {
    throw unreachableError();
  }
  if (res.status === 204) return null;
  if (!res.ok) await throwForStatus(res);
  return res.json().catch(() => ({}));
}

// Fetches a binary endpoint (a call recording's MP3) as a Blob — same
// base URL, session cookie and error shape as the JSON helpers, so a
// failed download reports the server's reason instead of leaving an
// <audio> element silently disabled.
async function requestBlob(path) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  } catch {
    throw unreachableError();
  }
  if (!res.ok) await throwForStatus(res);
  return res.blob();
}

export const api = {
  get: (path) => request(path, { method: "GET" }),
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  patch: (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: "DELETE" }),
  blob: requestBlob,
};
