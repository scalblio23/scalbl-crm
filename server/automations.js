// Automation execution engine — see api/automations.js for the CRUD
// side and src/SimpleCRM.jsx's "Automations" tab for the builder UI.
// An automation is one trigger + an ordered list of actions, same
// linear shape as GoHighLevel's workflow builder (no branching for
// this first version). Two trigger call sites feed this: a contact's
// tag changing (api/contacts.js) and a calendar booking being created
// (api/calendar-book.js) — both call runAutomationsForTrigger()
// fire-and-forget, the same way those files already fire off
// confirmation email/SMS sends without blocking their own response.
import { getActiveAutomationsByTrigger } from "./db.js";
import { sendCalendarEmail, missingEmailEnv } from "./email.js";
import { sendSms, missingTwilioEnv } from "./twilioCore.js";

function fillTemplate(text, data) {
  return String(text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => data[key] ?? "");
}

// Whether one automation's trigger_config matches this firing's
// context. An empty/missing filter always matches — e.g. a
// "Booking Created" automation with no calendar picked fires for
// every calendar, not none.
function triggerMatches(triggerType, config, context) {
  if (triggerType === "contact_tag_added") {
    if (!config?.tag) return true;
    return String(config.tag).toLowerCase() === String(context.tag || "").toLowerCase();
  }
  if (triggerType === "booking_created") {
    if (!config?.calendarId) return true;
    return Number(config.calendarId) === Number(context.calendarId);
  }
  return false;
}

// Runs one automation's actions in order. A step with no recipient
// (no email/phone on the contact) or an unconfigured provider is
// skipped rather than failing the whole chain — same fail-open
// philosophy as the Calendars feature's own confirmation sends.
async function runActions(automation, context) {
  const data = {
    name: context.contact?.name || "",
    email: context.contact?.email || "",
    phone: context.contact?.phone || "",
    tag: context.tag || "",
    calendar: context.calendarName || "",
    appointment_date_time: context.whenText || "",
    timezone: context.timezone || "",
  };
  for (const action of automation.actions || []) {
    if (action.type === "email") {
      if (!context.contact?.email || missingEmailEnv().length) continue;
      await sendCalendarEmail({
        to: context.contact.email,
        subject: fillTemplate(action.subject, data) || automation.name,
        html: fillTemplate(action.body, data).replace(/\n/g, "<br/>"),
      });
    } else if (action.type === "sms") {
      if (!context.contact?.phone || missingTwilioEnv().length) continue;
      await sendSms({ to: context.contact.phone, body: fillTemplate(action.body, data) });
    }
    // "call" isn't executed automatically yet — see the note next to
    // its option in the Automations builder UI.
  }
}

// `triggerType`: "contact_tag_added" | "booking_created".
// `context` shapes:
//   contact_tag_added: { tag, contact: { name, email, phone } }
//   booking_created: { calendarId, calendarName, contact, whenText }
export async function runAutomationsForTrigger(triggerType, context) {
  let automations;
  try {
    automations = await getActiveAutomationsByTrigger(triggerType);
  } catch (err) {
    console.error("[automations] failed to load automations", err);
    return;
  }
  for (const automation of automations) {
    if (!triggerMatches(triggerType, automation.triggerConfig, context)) continue;
    runActions(automation, context).catch((err) =>
      console.error(`[automations] "${automation.name}" failed`, err)
    );
  }
}
