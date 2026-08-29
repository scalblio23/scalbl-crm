import { ensureSchema } from "../server/db.js";
import { handlePublicBookingInfo } from "../server/bookingApi.js";

// GET /api/public-booking-info?slug=... — public. The booking page's
// display info (host name, title, description, meeting length,
// timezone) for a contact landing on /book/:slug.
export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { status, body } = await handlePublicBookingInfo(String(req.query.slug || ""));
    return res.status(status).json(body);
  } catch (err) {
    console.error("[api/public-booking-info]", err);
    return res.status(500).json({ error: "Could not load this booking page." });
  }
}
