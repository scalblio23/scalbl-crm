// The ONE pipeline status every lead has, regardless of which
// tag/client it belongs to. Shared by the database layer (which
// refuses to store anything else), the Express dev server, the Vercel
// functions and — mirrored as LEAD_STATUSES in src/SimpleCRM.jsx —
// the UI, so the Contacts table, kanban board, Powerdialler, wrap-up
// screen and Reports all speak the same four words.
//
// History: imported leads used to carry their sheet's own "STAGE"
// custom column (Booked / Not Interested / No Answer Yet / New / …)
// *alongside* this fixed status column, which stayed at "New Lead"
// for every one of them. The dialler's wrap-up wrote STAGE while the
// dialler's filters read status, so a lead marked Booked kept getting
// re-called. There is exactly one field now — see
// migrateLegacyStageToStatus in db.js for how the old values were
// folded in.
export const LEAD_STATUSES = ["New Lead", "No Answer", "Booked", "Not Interested"];
export const DEFAULT_LEAD_STATUS = "New Lead";

// Statuses that mean "do not call this lead again from the dialler".
export const CLOSED_LEAD_STATUSES = ["Booked", "Not Interested"];

export function isLeadStatus(value) {
  return LEAD_STATUSES.includes(value);
}

// Maps whatever a sheet / webhook / old client sent to one of the
// four canonical statuses, or null when it's blank or means nothing
// we recognise. Deliberately generous on the two "closed" outcomes —
// mis-reading "BOOKED " or "not interested." as a fresh lead is the
// exact bug this replaces — and conservative everywhere else:
// anything ambiguous ("Pending", "Callback Requested", an interest
// rate that leaked into a stage column, …) is NOT guessed at here and
// is left to the caller to default to New Lead.
export function normalizeLeadStatus(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (LEAD_STATUSES.some((v) => v.toLowerCase() === s)) {
    return LEAD_STATUSES.find((v) => v.toLowerCase() === s);
  }
  // Order matters: "not interested" must win before anything that
  // could match "interest", and "no show" is not "no answer".
  if (
    /\bnot interested\b|\bnot int\b|\buninterested\b|\bdisqualif|\bdnc\b|\bdo not call\b|\bdead\b|\blost\b|\bcancel|\bdeclin|\bunqualif|\bwrong number\b|\bremove\b|\bopt(ed)? out\b|^ni$|^n\/?i$/.test(
      s
    )
  ) {
    return "Not Interested";
  }
  if (/\bbook|\bappointment (set|booked)\b|\bappt\b|\bprogressed to close\b|\bupcoming\b|\bpaid\b|\bclosed won\b|\bwon\b|\bshowed\b|\bconverted\b/.test(s)) {
    return "Booked";
  }
  if (/\bno answer\b|\bno ans\b|\bnoanswer\b|\bvoicemail\b|\bvm\b|\bleft message\b|\bno pick ?up\b|\bdidn'?t (pick up|answer)\b|\bunanswered\b|\bno response\b|^na$|^n\/?a$/.test(s)) {
    return "No Answer";
  }
  if (/^new\b|\bnew lead\b|\bfresh\b|\buncontacted\b|\bnot called\b|\bto call\b|\bplease call\b|\bpleae call\b|\blead \(/.test(s)) {
    return "New Lead";
  }
  return null;
}

// First recognisable status among the candidates (in priority order),
// else New Lead. Used wherever an incoming record might carry the
// status under more than one name (e.g. a legacy `fields.stage` plus
// the fixed `status` column).
export function resolveLeadStatus(...candidates) {
  for (const c of candidates) {
    const s = normalizeLeadStatus(c);
    if (s) return s;
  }
  return DEFAULT_LEAD_STATUS;
}

// Custom-column keys that used to (or could again) shadow the fixed
// status column. Contact columns with these keys can't be created, and
// any such key arriving inside a record's `fields` is folded into
// `status` instead of being stored.
export const LEGACY_STATUS_FIELD_KEYS = ["stage", "status", "lead_status", "outcome"];

// Splits a record's `fields` into the ones to keep and the value of
// any legacy status-like key it carried (first one wins). Keys are
// matched after slugifying the same way contact columns are keyed, so
// "STAGE", "Stage " and "stage" all count.
export function extractLegacyStatusFromFields(fields, slugify) {
  const kept = {};
  let legacy = null;
  for (const [key, value] of Object.entries(fields || {})) {
    const slug = slugify ? slugify(key) : String(key).trim().toLowerCase();
    if (LEGACY_STATUS_FIELD_KEYS.includes(slug)) {
      if (legacy === null && value !== null && value !== undefined && String(value).trim() !== "") legacy = value;
      continue;
    }
    kept[key] = value;
  }
  return { fields: kept, legacyStatus: legacy };
}
