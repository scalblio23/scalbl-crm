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

// Files up to this size are sent as one buffered body (see below);
// comfortably under Vercel's 4.5MB buffered-response ceiling, and
// roughly a 15-minute call at Twilio's MP3 bitrate.
const BUFFERED_LIMIT_BYTES = 4 * 1024 * 1024;

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

    // Always fetch the whole file and hand it over as one plain 200 —
    // no Range passthrough, no forwarded Content-Length/Content-Range.
    // Relaying Twilio's 206 partial responses and length headers
    // through the serverless streaming bridge is what produced audio
    // that played as crackle: the framing didn't survive the hop. A
    // complete, buffered body can't be mis-framed, so anything that
    // fits under the platform's buffered-response ceiling goes that
    // way; only a long call's file is streamed, and even then without
    // a Content-Length so the bridge frames it itself.
    const upstream = await fetchRecordingMedia(sid);
    if (upstream.status !== 200) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: "Recording unavailable" });
    }
    res.status(200);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Accept-Ranges", "none");
    if (req.method === "HEAD" || !upstream.body) return res.end();

    const declared = Number(upstream.headers.get("content-length")) || 0;
    if (declared > 0 && declared <= BUFFERED_LIMIT_BYTES) {
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Length", String(bytes.length));
      return res.end(bytes);
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error("[api/recording-audio]", err);
    return res.status(500).json({ error: err.message || "Could not fetch the recording" });
  }
}
