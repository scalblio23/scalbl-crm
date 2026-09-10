// Streams a call recording's MP3 from Twilio to a logged-in user —
// the src of the player in the Conversation tab (see the 'recording'
// message type in src/SimpleCRM.jsx). Twilio's own media URLs need
// account credentials, which never reach the browser; this proxies
// the file behind the app's session cookie instead. Client-portal
// users are held to the same tag scope as everything else they see.
import { Readable } from "node:stream";
import { ensureSchema, getRecordingLeadTag } from "../server/db.js";
import { requireAuth, scopeTagsForUser } from "../server/auth.js";
import { fetchRecordingMedia } from "../server/twilioCore.js";

// Lets Vercel stream the response instead of buffering it — a long
// call's MP3 can run past the buffered-response size limit.
export const config = { supportsResponseStreaming: true };

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }
  try {
    const sid = String(req.query?.sid || "");
    if (!/^RE[0-9a-f]{32}$/i.test(sid)) return res.status(400).json({ error: "Invalid recording id" });

    const allowedTags = scopeTagsForUser(user);
    if (allowedTags) {
      await ensureSchema();
      const { found, tag } = await getRecordingLeadTag(sid);
      if (!found || !tag || !allowedTags.includes(tag)) return res.status(404).json({ error: "Recording not found" });
    }

    const upstream = await fetchRecordingMedia(sid, { range: req.headers.range });
    if (upstream.status !== 200 && upstream.status !== 206) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: "Recording unavailable" });
    }
    res.status(upstream.status);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (req.method === "HEAD" || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error("[api/recording-audio]", err);
    return res.status(500).json({ error: err.message || "Could not fetch the recording" });
  }
}
