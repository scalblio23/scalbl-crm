import { ensureSchema } from "../server/db.js";
import { handleGoogleCallback } from "../server/bookingApi.js";

// GET /api/google-callback — Google redirects the user's browser here
// after they approve (or deny) access. Public: identity comes from the
// signed `state` param minted in api/google-connect.js, not a session
// cookie (Google's redirect is a fresh top-level navigation that may
// not carry it). Always ends in a redirect back into the app.
export default async function handler(req, res) {
  try {
    await ensureSchema();
    const { code, state, error } = req.query || {};
    const { redirect } = await handleGoogleCallback({ code, state, error });
    res.writeHead(302, { Location: redirect });
    res.end();
  } catch (err) {
    console.error("[api/google-callback]", err);
    res.writeHead(302, { Location: `/?page=booking&google=error&message=${encodeURIComponent(err.message || "Connection failed")}` });
    res.end();
  }
}
