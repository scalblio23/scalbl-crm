// A booking link per contact tag — shown on the Powerdialler / Multi
// Line hotseat and wrap-up screen for whichever tag the live lead
// carries. GET is open to any logged-in role; saving is an org-wide
// setting, so it's restricted the same way tag folders are.
import { ensureSchema, getTagBookingLinks, setTagBookingLink } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getTagBookingLinks());
    }

    if (forbidClientRole(user, res)) return;

    if (req.method === "PATCH") {
      const { tagName, bookingLink } = req.body || {};
      if (!tagName || !String(tagName).trim()) return res.status(400).json({ error: "Missing tagName" });
      return res.status(200).json(await setTagBookingLink(String(tagName).trim(), bookingLink));
    }

    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/tag-booking-links]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
