// A proposal's public signing link (/proposal/<token>) — no login; the
// unguessable token in the link is what identifies the proposal, same
// trust model as a calendar booking's cancel link.
//
//   GET ?token=                    → { proposal: { name, company, amount, period, status, signedDate, signedAt, signatureImage } }
//   POST { token, image, date }    → { proposal }   image: PNG data URL, date: YYYY-MM-DD
import { ensureSchema, getProposalByToken, signProposal } from "../server/db.js";

// A trimmed signature PNG is a few KB to a few tens of KB.
const MAX_SIGNATURE_CHARS = 600_000;

// Only what the lead's page needs — never internal ids or who made it.
function publicView(p) {
  return {
    name: p.name,
    company: p.company,
    amount: p.amount,
    period: p.period,
    status: p.status,
    signedDate: p.signedDate,
    signedAt: p.signedAt,
    signatureImage: p.signatureImage,
  };
}

function clientIp(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || null;
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const token = String(req.query?.token || "");
      const proposal = token ? await getProposalByToken(token) : null;
      if (!proposal) return res.status(404).json({ error: "This proposal link isn't valid any more." });
      return res.status(200).json({ proposal: publicView(proposal) });
    }

    if (req.method === "POST") {
      const token = String(req.body?.token || "");
      const image = String(req.body?.image || "");
      const date = String(req.body?.date || "");
      if (!token) return res.status(400).json({ error: "Missing token" });
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_SIGNATURE_CHARS) {
        return res.status(400).json({ error: "Add your signature first." });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Pick the date first." });

      const signed = await signProposal(token, { image, date, ip: clientIp(req) });
      if (signed) return res.status(200).json({ proposal: publicView(signed) });
      const existing = await getProposalByToken(token);
      if (!existing) return res.status(404).json({ error: "This proposal link isn't valid any more." });
      return res.status(409).json({ error: "This proposal has already been signed.", proposal: publicView(existing) });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/proposal-public]", err);
    return res.status(err.status || 500).json({ error: err.message || "Database error" });
  }
}
