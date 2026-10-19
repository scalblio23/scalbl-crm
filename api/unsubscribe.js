import { ensureSchema, addEmailUnsubscribe } from "../server/db.js";
import { verifyUnsubscribeToken } from "../server/broadcasts.js";

// /api/unsubscribe?e=<email>&t=<signed token> — the link at the bottom
// of every broadcast. GET shows a confirm button (so a mail scanner
// opening the link doesn't unsubscribe anyone); POST unsubscribes —
// that's also what Gmail/Yahoo's one-click unsubscribe sends
// (List-Unsubscribe-Post).

function page(title, message, form = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f9fafb;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.c{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;max-width:420px;text-align:center}
button{background:#111;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;cursor:pointer}</style></head>
<body><div class="c"><h1 style="font-size:20px">${title}</h1><p style="color:#555">${message}</p>${form}</div></body></html>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export default async function handler(req, res) {
  const email = String(req.query?.e || "").trim().toLowerCase();
  const token = String(req.query?.t || "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!email || !verifyUnsubscribeToken(email, token)) {
    return res.status(400).send(page("Link not valid", "This unsubscribe link is incomplete or has been changed."));
  }
  if (req.method === "POST") {
    try {
      await ensureSchema();
      await addEmailUnsubscribe(email);
    } catch (err) {
      console.error("[api/unsubscribe]", err);
      return res.status(500).send(page("Something went wrong", "Please try again in a moment."));
    }
    return res.status(200).send(page("You're unsubscribed", `${esc(email)} won't receive these emails any more.`));
  }
  const action = `?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
  return res
    .status(200)
    .send(page("Unsubscribe", `Stop receiving these emails at ${esc(email)}?`, `<form method="post" action="${action}"><button type="submit">Unsubscribe</button></form>`));
}
