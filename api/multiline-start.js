import {
  ensureSchema,
  getContactsByIds,
  createMultilineBatch,
  addMultilineBatchCall,
  setMultilineBatchCallSid,
  updateMultilineBatchCallStatusByRowId,
  mapWithConcurrency,
} from "../server/db.js";
import {
  missingTwilioEnv,
  getCallerIdPool,
  generateMultilineConferenceName,
  placeConferenceLeg,
  publicBaseUrl,
} from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// Dial several leads at once for one rep — first to answer gets
// bridged in (see api/multiline-status.js), the rest get hung up.
// Capped well below what a single rep could realistically talk their
// way through, mostly as a cost/sanity backstop.
const MAX_LINES = 6;

// POST /api/multiline-start — body: { leadIds: number[] }. Places one
// REST-dialled leg per lead (all joining the same fresh conference —
// see server/twilioCore.js) and returns straight away; the rep's own
// browser leg joins that same conference separately (see
// src/lib/twilioDevice.js's joinConference), and progress from here
// is read via GET /api/multiline-batch.
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
    const base = publicBaseUrl();
    if (!base) {
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
      const row = await addMultilineBatchCall({
        batchId: batch.id,
        leadId: contact.id,
        name: contact.name,
        phone: contact.phone,
        fromNumber,
      });
      try {
        const call = await placeConferenceLeg({
          to: contact.phone,
          from: fromNumber,
          url: `${base}/api/voice-multiline-leg?conf=${encodeURIComponent(conferenceName)}`,
          statusCallback: `${base}/api/multiline-status?rowId=${row.id}&batchId=${batch.id}&leadId=${contact.id}`,
        });
        await setMultilineBatchCallSid(row.id, call.sid);
      } catch (err) {
        console.error("[api/multiline-start] leg failed", contact.id, err.message);
        await updateMultilineBatchCallStatusByRowId(row.id, "failed");
      }
      return { leadId: contact.id, name: contact.name, phone: contact.phone, fromNumber };
    });

    return res.status(201).json({ batchId: batch.id, conferenceName, candidates });
  } catch (err) {
    console.error("[api/multiline-start]", err);
    return res.status(500).json({ error: err.message || "Could not start multi-line dialling" });
  }
}
