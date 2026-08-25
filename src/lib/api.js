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
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  get: (path) => request(path, { method: "GET" }),
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  patch: (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: "DELETE" }),
};
