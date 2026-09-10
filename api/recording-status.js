// Public endpoint — Twilio's recordingStatusCallback, hit once a call's
// recording has finished processing (see recordingOptions in
// server/twilioCore.js for where it's declared). Same trust model as
// the other Twilio webhooks here (/api/voice, /api/multiline-status):
// Twilio is the only caller, identified by the ids baked into the URL.
//
// Works out which lead the recording belongs to — the leadId baked in
// for a contact call, the batch's winner for a Multi Line conference,
// or a phone match for a manual dial — and drops it into that lead's
// conversation as a playable message. A recording that can't be
// attributed (manual dial to a number that isn't a contact, a Multi
// Line round nobody answered) is left on Twilio and not posted.
import {
  ensureSchema,
  getContactById,
  findContactByPhone,
  getMultilineWinnerByConferenceName,
  hasRecordingMessage,
  logRecordingMessage,
} from "../server/db.js";

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  try {
    await ensureSchema();
    const { RecordingSid, RecordingStatus, RecordingDuration } = req.body || {};
    if (!RecordingSid) return res.status(400).end();
    // Only "completed" carries a finished, fetchable recording.
    if (RecordingStatus && RecordingStatus !== "completed") return res.status(204).end();
    if (await hasRecordingMessage(RecordingSid)) return res.status(204).end(); // Twilio retried

    const leadId = Number(req.query?.leadId) || null;
    const conferenceName = req.query?.conf;
    const to = req.query?.to;
    let lead = null;
    if (leadId) {
      const contact = await getContactById(leadId);
      if (contact) lead = { leadId: contact.id, name: contact.name };
    } else if (conferenceName) {
      lead = await getMultilineWinnerByConferenceName(conferenceName);
    } else if (to) {
      const contact = await findContactByPhone(to);
      if (contact) lead = { leadId: contact.id, name: contact.name };
    }
    if (!lead) return res.status(204).end();

    const seconds = Math.max(0, Math.round(Number(RecordingDuration) || 0));
    const timeLabel = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
    await logRecordingMessage({
      leadId: lead.leadId,
      name: lead.name,
      text: `Call recording · ${formatDuration(seconds)}`,
      time: timeLabel,
      recordingSid: RecordingSid,
    });
    return res.status(204).end();
  } catch (err) {
    // A 5xx makes Twilio retry the callback; hasRecordingMessage above
    // keeps a retry from double-posting once it does get through.
    console.error("[api/recording-status]", err);
    return res.status(500).end();
  }
}
