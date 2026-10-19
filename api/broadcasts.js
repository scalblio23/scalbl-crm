import {
  ensureSchema,
  resolveBroadcastAudience,
  createBroadcast,
  listBroadcasts,
  listBroadcastFailures,
} from "../server/db.js";
import { requireAuth, forbidClientRole, forbidWithoutTab } from "../server/auth.js";
import { sendEmail, missingEmailEnv, checkSender, textToHtml } from "../server/email.js";
import { sendNextBroadcastBatch, personalize, publicLinkBase } from "../server/broadcasts.js";

// The Broadcast tab. Staff only (never a client login).
//   GET                        → past broadcasts with sent/failed counts
//   GET ?failures=<id>         → who a broadcast failed for, and why
//   POST { action: "preview", tags, statuses, contactIds } → recipient count
//   POST { action: "test", to, subject, body, fromName, fromEmail }
//   POST { action: "create", subject, body, tags, statuses, contactIds, fromName, fromEmail }
//   POST { action: "send-next", id } → sends the next batch of 100
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  if (forbidWithoutTab(user, "broadcast", res)) return;
  try {
    await ensureSchema();
    if (req.method === "GET") {
      if (req.query?.failures) return res.status(200).json(await listBroadcastFailures(req.query.failures));
      return res.status(200).json(await listBroadcasts());
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const b = req.body || {};
    const audience = { tags: b.tags || [], statuses: b.statuses || [], contactIds: b.contactIds || [] };

    if (b.action === "preview") {
      const { recipients, skippedNoEmail, skippedUnsubscribed } = await resolveBroadcastAudience(audience);
      return res.status(200).json({
        count: recipients.length,
        skippedNoEmail,
        skippedUnsubscribed,
        sample: recipients.slice(0, 5).map((r) => ({ name: r.name, email: r.email })),
      });
    }

    const missing = missingEmailEnv();
    if (missing.length) return res.status(503).json({ error: `Email isn't set up yet. Missing: ${missing.join(", ")}` });
    if (b.action === "send-next") {
      const handled = await sendNextBroadcastBatch(Number(b.id) || 0);
      const row = (await listBroadcasts(200)).find((x) => x.id === Number(b.id));
      if (!row) return res.status(404).json({ error: "Broadcast not found" });
      return res.status(200).json({ handled, broadcast: row });
    }

    const subject = String(b.subject || "").trim();
    const body = String(b.body || "");
    if (!subject) return res.status(400).json({ error: "Add a subject." });
    if (!body.trim()) return res.status(400).json({ error: "Write a message." });
    if (subject.length > 300 || body.length > 50000) return res.status(400).json({ error: "That email is too long." });
    const sender = checkSender(b);
    if (sender.error) return res.status(400).json({ error: sender.error });
    if (!publicLinkBase()) {
      return res.status(503).json({ error: "Set PUBLIC_URL in Vercel (the CRM's https:// address) so unsubscribe links work." });
    }

    if (b.action === "test") {
      const to = String(b.to || user.email || "").trim().toLowerCase();
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) return res.status(400).json({ error: "Enter a valid test address." });
      const sample = { name: user.name || "", email: to };
      await sendEmail({
        to,
        subject: `[TEST] ${personalize(subject, sample)}`,
        html: textToHtml(personalize(body, sample)),
        text: personalize(body, sample),
        fromName: sender.name,
        fromEmail: sender.email,
      });
      return res.status(200).json({ ok: true, to });
    }

    if (b.action === "create") {
      const { recipients } = await resolveBroadcastAudience(audience);
      if (!recipients.length) return res.status(400).json({ error: "No one to send to — check the tags/statuses you picked." });
      if (recipients.length > 20000) return res.status(400).json({ error: "That's over 20,000 recipients — split it into smaller broadcasts." });
      const created = await createBroadcast({
        subject,
        body,
        fromName: sender.name,
        fromEmail: sender.email,
        audience,
        recipients,
        createdBy: user.name || user.email || "",
      });
      return res.status(201).json({ id: created.id, total: recipients.length });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("[api/broadcasts]", err);
    return res.status(500).json({ error: err.message || "Broadcast failed" });
  }
}
