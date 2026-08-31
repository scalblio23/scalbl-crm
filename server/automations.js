// Automation execution engine — see api/automations.js for the CRUD
// side and src/SimpleCRM.jsx's "Automations" tab for the builder UI.
// An automation is one trigger + an ordered list of steps (email, sms,
// or wait), same linear shape as GoHighLevel's workflow builder (no
// branching for this first version).
//
// Why a durable queue instead of just running every step in one pass:
// a "wait" step can mean hours or days, and this app runs as
// serverless functions — the request that fired the trigger is long
// gone by the time a multi-day wait is up. So a trigger firing
// doesn't run the automation itself; it creates one `automation_runs`
// row (see server/db.js) and immediately tries to advance it as far
// as it can. advanceAutomationRun() executes steps one at a time,
// stopping the moment it hits a "wait" (rescheduling the row's run_at
// instead) or runs out of steps (marking it done). Whatever's left
// waiting gets picked up later by processDueAutomationRuns(), called
// on a schedule — api/automations-process-runs.js (Vercel Cron in
// production) and a setInterval poller in server/index.js (local dev,
// which has no cron of its own).
import {
  getActiveAutomationsByTrigger,
  getAutomationById,
  createAutomationRun,
  claimAutomationRunById,
  claimDueAutomationRuns,
  updateAutomationRunProgress,
} from "./db.js";
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

const WAIT_UNIT_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };

// "Wait for X" waits from whenever this step is reached. "Wait
// before appointment" counts backwards from the booking's start time
// instead — only meaningful for a booking_created run, which is the
// only case context.appointmentStartUTC is ever set; falling back to
// a plain "from now" wait if it's missing (e.g. a contact_tag_added
// run that somehow has a before_appointment step on file) is a
// reasonable degrade rather than a hard failure.
function computeWaitRunAt(step, context) {
  const amountMs = (Number(step.amount) || 0) * (WAIT_UNIT_MS[step.unit] || WAIT_UNIT_MS.minutes);
  if (step.mode === "before_appointment" && context.appointmentStartUTC) {
    return new Date(new Date(context.appointmentStartUTC).getTime() - amountMs);
  }
  return new Date(Date.now() + amountMs);
}

// Runs one non-wait step. A step with no recipient (no email/phone on
// the contact) or an unconfigured provider is skipped rather than
// failing the whole run — same fail-open philosophy as the Calendars
// feature's own confirmation sends.
async function runStep(step, automation, context) {
  const data = {
    name: context.contact?.name || "",
    email: context.contact?.email || "",
    phone: context.contact?.phone || "",
    tag: context.tag || "",
    calendar: context.calendarName || "",
    appointment_date_time: context.whenText || "",
    // Kept as an alias — an automation saved before {{when}} was
    // renamed to {{appointment_date_time}} still has the old token in
    // its subject/body, and would otherwise render it as literal,
    // unfilled "{{when}}" text forever.
    when: context.whenText || "",
    timezone: context.timezone || "",
  };
  if (step.type === "email") {
    if (!context.contact?.email || missingEmailEnv().length) return;
    await sendCalendarEmail({
      to: context.contact.email,
      subject: fillTemplate(step.subject, data) || automation.name,
      html: fillTemplate(step.body, data).replace(/\n/g, "<br/>"),
    });
  } else if (step.type === "sms") {
    if (!context.contact?.phone || missingTwilioEnv().length) return;
    await sendSms({ to: context.contact.phone, body: fillTemplate(step.body, data) });
  }
  // "call" isn't executed automatically yet — see its disabled option
  // in the Automations builder UI.
}

// Moves one claimed/newly-created run forward as far as it can go
// right now: runs steps in order, stopping (and rescheduling) at the
// next "wait" step, or marking the run 'done' once the actions array
// is exhausted. A step that throws is logged and skipped rather than
// aborting the rest of the chain — one bad send shouldn't block a
// later step in the same automation.
export async function advanceAutomationRun(run) {
  const automation = await getAutomationById(run.automationId);
  if (!automation || !automation.active) {
    await updateAutomationRunProgress(run.id, { status: "done" });
    return;
  }
  const actions = automation.actions || [];
  let index = run.nextStepIndex;
  while (index < actions.length) {
    const step = actions[index];
    if (step.type === "wait") {
      const runAt = computeWaitRunAt(step, run.context);
      await updateAutomationRunProgress(run.id, { nextStepIndex: index + 1, runAt, status: "pending" });
      return;
    }
    try {
      await runStep(step, automation, run.context);
    } catch (err) {
      console.error(`[automations] "${automation.name}" step ${index} failed`, err);
      await updateAutomationRunProgress(run.id, { lastError: String(err.message || err).slice(0, 500) });
    }
    index += 1;
  }
  await updateAutomationRunProgress(run.id, { nextStepIndex: index, status: "done" });
}

// `triggerType`: "contact_tag_added" | "booking_created".
// `context` shapes:
//   contact_tag_added: { tag, contact: { name, email, phone } }
//   booking_created: { calendarId, calendarName, contact, whenText,
//     timezone, appointmentStartUTC }
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
    try {
      const run = await createAutomationRun({ automationId: automation.id, context, runAt: new Date() });
      // Claim it before advancing — without this, the row sits at
      // status 'pending' for the whole duration of the advance below
      // (which can include real email/SMS sends), and the cron
      // poller's claimDueAutomationRuns() firing in that window would
      // match the same row and process it a second time. The atomic
      // 'pending' -> 'processing' guard means whichever of the two
      // gets here first wins; the loser (0 rows affected) does
      // nothing instead of double-sending.
      const claimed = await claimAutomationRunById(run.id);
      if (!claimed) continue; // lost the race — the poller already has it
      // Advance immediately (fire-and-forget) so an automation with no
      // wait steps still fires right away instead of waiting for the
      // next poll — processDueAutomationRuns() is the fallback/
      // catch-all, not the only path.
      advanceAutomationRun(claimed).catch((err) => console.error(`[automations] "${automation.name}" failed`, err));
    } catch (err) {
      console.error(`[automations] failed to start run for "${automation.name}"`, err);
    }
  }
}

// Called on a schedule (Vercel Cron in production, a setInterval in
// local dev — see api/automations-process-runs.js and
// server/index.js) to move forward whatever's due. Returns how many
// runs it claimed, purely for the endpoint's own response/logging.
export async function processDueAutomationRuns(limit = 20) {
  const runs = await claimDueAutomationRuns(limit);
  for (const run of runs) {
    await advanceAutomationRun(run).catch((err) => console.error("[automations] failed to advance a run", err));
  }
  return runs.length;
}
