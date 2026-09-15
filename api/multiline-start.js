import { ensureSchema, getContactsByIds, createMultilineBatch, addMultilineBatchCall, mapWithConcurrency } from "../server/db.js";
import { missingTwilioEnv, getCallerIdPool, generateMultilineConferenceName, publicBaseUrl, MULTILINE_RING_SECONDS } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// Dial several leads at once for one rep — first to answer gets
// bridged in (see api/multiline-status.js), the rest get hung up.
// Capped well below what a single rep could realistically talk their
// way through, mostly as a cost/sanity backstop.
const MAX_LINES = 6;

// POST /api/multiline-start — body: { leadIds: number[] }. Reserves a
// batch and a row per lead (so each has an id to embed in its own
// TwiML/status-callback URLs later) but does NOT dial anyone yet —
// that's api/multiline-place-legs.js, called once the frontend's own
// conference leg has actually joined and started the conference (see
// its comment for why the split exists: dialling a lead before the
// rep's own leg has joined leaves that lead's call sitting in the
// conference on hold — unable to hear anything — until the rep
// catches up, which a fast-answering lead can easily notice as "they
// can't hear me").
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const missing = missingTwilioEnv();
    if (missing.length) {
      return res.status(500).json({ error: `Twilio is not configured. Missing: ${missing.join(", ")}` });
    }
    if (!publicBaseUrl()) {
      return res.status(500).json({
        error:
          "Multi-line dialling needs PUBLIC_URL set (or a Vercel deployment) so Twilio can reach the per-call callback URLs it uses.",
      });
    }

    const ids = Array.isArray(req.body?.leadIds) ? req.body.leadIds.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: "Select at least one lead to dial" });

    const contacts = await getContactsByIds(ids);
    const withPhone = contacts.filter((c) => c.phone).slice(0, MAX_LINES);
    if (!withPhone.length) {
      return res.status(400).json({ error: "None of the selected leads have a phone number" });
    }

    const conferenceName = generateMultilineConferenceName();
    const batch = await createMultilineBatch({ conferenceName, createdBy: String(user.id) });
    const pool = getCallerIdPool(); // guaranteed non-empty — missingTwilioEnv() checked above

    const candidates = await mapWithConcurrency(withPhone, withPhone.length, async (contact, i) => {
      const fromNumber = pool[i % pool.length];
      await addMultilineBatchCall({ batchId: batch.id, leadId: contact.id, name: contact.name, phone: contact.phone, fromNumber });
      return { leadId: contact.id, name: contact.name, phone: contact.phone, fromNumber };
    });

    return res.status(201).json({ batchId: batch.id, conferenceName, candidates, ringSeconds: MULTILINE_RING_SECONDS });
  } catch (err) {
    console.error("[api/multiline-start]", err);
    return res.status(500).json({ error: err.message || "Could not start multi-line dialling" });
  }
}
