// Proposals tab (admin side) — every proposal sent to a lead and where
// it's at. Team only: client-role users are refused. The lead's side —
// opening and signing their link — is api/proposal-public.js.
//
//   GET                                              → { proposals: [{ id, token, name, company, amount, period, status, signedDate, signedAt, createdAt, createdByName }] }
//   POST { action: "create", name, company, amount, period } → { proposal }
//   POST { action: "set-status", id, status }        → { proposal }   status: pending | signed | finished
//   DELETE ?id=
import {
  ensureSchema,
  getProposals,
  createProposal,
  setProposalStatus,
  deleteProposal,
  PROPOSAL_STATUSES,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

export default async function handler(req, res) {
  const schema = ensureSchema();
  schema.catch(() => {});
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await schema;

    if (req.method === "GET") {
      return res.status(200).json({ proposals: await getProposals() });
    }

    if (req.method === "POST") {
      const { action } = req.body || {};

      if (action === "create") {
        const name = String(req.body?.name || "").trim().slice(0, 200);
        const company = String(req.body?.company || "").trim().slice(0, 200);
        const amount = String(req.body?.amount || "").replace(/[^0-9.]/g, "").slice(0, 20);
        const period = Math.round(Number(req.body?.period) || 3);
        if (!name) return res.status(400).json({ error: "Add the client's name first." });
        if (!amount) return res.status(400).json({ error: "Add the monthly amount first." });
        if (period < 1 || period > 12) return res.status(400).json({ error: "Period must be 1–12 months." });
        const proposal = await createProposal({
          name,
          company,
          amount,
          period,
          createdBy: Number.isInteger(user.id) ? user.id : null,
        });
        return res.status(201).json({ proposal });
      }

      if (action === "set-status") {
        const id = Number(req.body?.id);
        const status = String(req.body?.status || "");
        if (!PROPOSAL_STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status" });
        const proposal = await setProposalStatus(id, status);
        if (!proposal) return res.status(404).json({ error: "Proposal not found" });
        return res.status(200).json({ proposal });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    if (req.method === "DELETE") {
      const id = Number(req.query?.id);
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteProposal(id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/proposals]", err);
    return res.status(err.status || 500).json({ error: err.message || "Database error" });
  }
}
