// Thin fetch wrapper for the database API. Same base-URL convention
// as twilioDevice.js: empty string = same-origin (/api/...), correct
// for the deployed site; local dev overrides it via
// VITE_CALL_SERVER_URL in .env to point at the Express server on
// :3001 instead.
const API_BASE = import.meta.env.VITE_CALL_SERVER_URL || "";

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      ...options,
    });
  } catch {
    throw new Error(
      API_BASE
        ? `Can't reach the backend at ${API_BASE}. Is \`npm run server\` running?`
        : "Can't reach the API on this deployment. Check the Vercel Functions logs."
    );
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Fetches a file the backend streams back (e.g. a call recording) and
// hands it to the browser as a download, so a failure — say, a
// recording Twilio hasn't finished processing — surfaces as a normal
// error message rather than a raw JSON page in a new tab.
async function download(path, fallbackName) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  } catch {
    throw new Error(
      API_BASE
        ? `Can't reach the backend at ${API_BASE}. Is \`npm run server\` running?`
        : "Can't reach the API on this deployment. Check the Vercel Functions logs."
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Download failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const api = {
  get: (path) => request(path, { method: "GET" }),
  download,
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  patch: (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: "DELETE" }),
};
