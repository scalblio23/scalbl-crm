import { ensureSchema } from "../server/db.js";
import { handlePublicBook } from "../server/bookingApi.js";

// POST /api/public-book — public. Body: { slug, start, end, name,
// email, timezone, notes }. Re-validates the slot, creates the Google
// Calendar event on the host's chosen destination calendar, records
// the booking, and emails the contact a confirmation from the host's
// connected Gmail address.
export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { status, body } = await handlePublicBook(req.body || {});
    return res.status(status).json(body);
  } catch (err) {
    console.error("[api/public-book]", err);
    return res.status(500).json({ error: err.message || "Could not complete the booking." });
  }
}
