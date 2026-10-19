import { randomUUID } from "node:crypto";
import {
  ensureSchema,
  listInboundEmails,
  getInboundEmail,
  setInboundEmailUnread,
  saveOutgoingEmail,
  canEmailAddress,
} from "../server/db.js";
import { requireAuth, scopeTagsForUser, hasFullAccess } from "../server/auth.js";
import { sendEmail, missingEmailEnv, textToHtml, senderDefaults, checkSender } from "../server/email.js";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// Conversations → Email. GET lists received emails (newest first);
// GET ?id= returns one with its body and marks it read; PATCH
// { id, unread } flips read state; POST { to, subject, body,
// replyToId? } sends one (a reply threads under the email it answers). A client role (or staff limited to
// some tags) only ever sees emails from contacts under their tags.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const scopeTags = scopeTagsForUser(user);
  try {
    await ensureSchema();
    if (req.method === "GET") {
      // The default sender, and whether this user may change it (staff
      // yes; a client always sends as the company).
      if (req.query?.sender) {
        const d = senderDefaults();
        return res.status(200).json({ ...d, canChange: hasFullAccess(user.role) });
      }
      if (req.query?.id) {
        const email = await getInboundEmail(req.query.id, scopeTags);
        if (!email) return res.status(404).json({ error: "Email not found" });
        if (email.unread) {
          await setInboundEmailUnread(email.id, false, scopeTags);
          email.unread = false;
        }
        return res.status(200).json(email);
      }
      return res.status(200).json(await listInboundEmails(scopeTags));
    }
    if (req.method === "PATCH") {
      const { id, unread } = req.body || {};
      const email = await setInboundEmailUnread(id, unread, scopeTags);
      if (!email) return res.status(404).json({ error: "Email not found" });
      return res.status(200).json(email);
    }
    if (req.method === "POST") {
      const missing = missingEmailEnv();
      if (missing.length) return res.status(503).json({ error: `Email isn't set up yet. Missing: ${missing.join(", ")}` });
      const { replyToId } = req.body || {};
      let to = String(req.body?.to || "").trim().toLowerCase();
      let subject = String(req.body?.subject || "").trim();
      const body = String(req.body?.body || "");
      const headers = {};
      if (replyToId) {
        const original = await getInboundEmail(replyToId, scopeTags);
        if (!original) return res.status(404).json({ error: "Email not found" });
        if (!to) to = original.outgoing ? String(original.to?.[0] || "") : original.fromEmail;
        if (!subject) subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject || ""}`.trim();
        if (original.messageId) {
          headers["In-Reply-To"] = original.messageId;
          headers.References = original.messageId;
        }
      }
      if (!EMAIL_RE.test(to)) return res.status(400).json({ error: "Enter a valid email address." });
      if (!subject) return res.status(400).json({ error: "Add a subject." });
      if (!body.trim()) return res.status(400).json({ error: "Write a message." });
      if (subject.length > 300 || body.length > 50000) return res.status(400).json({ error: "That email is too long." });
      // A client (or tag-limited staff) can only email their own contacts.
      if (!(await canEmailAddress(to, scopeTags))) {
        return res.status(403).json({ error: "You can only email contacts under your tags." });
      }
      // Staff can pick the From name/address (on the verified domain); a
      // client always sends as the default sender.
      const sender = hasFullAccess(user.role) ? checkSender(req.body || {}) : checkSender({});
      if (sender.error) return res.status(400).json({ error: sender.error });
      const html = textToHtml(body);
      const sent = await sendEmail({ to, subject, html, text: body, headers, fromName: sender.name, fromEmail: sender.email });
      const saved = await saveOutgoingEmail({
        resendId: sent?.id || `out-${randomUUID()}`,
        fromEmail: sender.email,
        fromName: sender.name,
        to,
        subject,
        text: body,
        html,
        sentBy: user.name || user.email || "",
      });
      return res.status(201).json(saved);
    }
    res.setHeader("Allow", "GET, PATCH, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/emails]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
