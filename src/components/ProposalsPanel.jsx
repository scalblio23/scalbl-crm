// Proposals tab — team only. Three sections:
//   Responses       every proposal sent: name, date, status (Pending →
//                   Signed when the lead signs → Finished when we close it)
//   Create Template fill in the client's details, get their unique
//                   signing link (/proposal/<token>) to copy and send
//   Template        the proposal itself, as the lead will see it
// The lead's side is src/ProposalPage.jsx; the API is api/proposals.js.
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, FileSignature, Loader2, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import ProposalDocument, { PROPOSAL_CSS, PlaceholderSignBlock, periodText } from "./ProposalDocument.jsx";

const SECTIONS = [
  { key: "responses", label: "Responses" },
  { key: "create", label: "Create Template" },
  { key: "template", label: "Template" },
];

const STATUS_STYLES = {
  pending: { label: "Pending", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  signed: { label: "Signed", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  finished: { label: "Finished", cls: "bg-green-50 text-green-700 border-green-200" },
};

const EMPTY_FORM = { name: "", company: "", amount: "", period: 3 };

export const proposalUrl = (p) => `${window.location.origin}/proposal/${p.token}`;

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 2000);
    } catch {
      window.prompt("Copy this link:", text);
    }
  };
  return [copied, copy];
}

function DocPreview({ name, amount, period }) {
  return (
    <div className="sp-root bg-[#f3f5f9] rounded-lg border border-gray-200 py-6 px-3">
      <style>{PROPOSAL_CSS}</style>
      <ProposalDocument
        name={name}
        amount={amount}
        period={period}
        signBlock={<PlaceholderSignBlock name={name} />}
      />
    </div>
  );
}

export default function ProposalsPanel() {
  const [section, setSection] = useState("responses");
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [copied, copy] = useCopy();

  const load = () =>
    api
      .get("/api/proposals")
      .then((r) => {
        setProposals(r.proposals || []);
        setError("");
      })
      .catch((e) => setError(e.message || "Couldn't load proposals."))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  // Pick up signatures as they come in while the Responses list is open.
  useEffect(() => {
    if (section !== "responses") return undefined;
    const timer = setInterval(() => document.visibilityState !== "hidden" && load(), 30000);
    return () => clearInterval(timer);
  }, [section]);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const { proposal } = await api.post("/api/proposals", { action: "create", ...form });
      setProposals((list) => [proposal, ...list]);
      setCreated(proposal);
      copy(`new-${proposal.id}`, proposalUrl(proposal));
    } catch (err) {
      setError(err.message || "Couldn't create the proposal.");
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (p, status) => {
    try {
      const { proposal } = await api.post("/api/proposals", { action: "set-status", id: p.id, status });
      setProposals((list) => list.map((x) => (x.id === p.id ? proposal : x)));
    } catch (err) {
      setError(err.message || "Couldn't update that proposal.");
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete the proposal for ${p.name}? Its link will stop working.`)) return;
    try {
      await api.delete(`/api/proposals?id=${p.id}`);
      setProposals((list) => list.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(err.message || "Couldn't delete that proposal.");
    }
  };

  const inputCls =
    "w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-6 flex items-center justify-between border-b border-gray-100">
        <div>
          <h1 className="text-xl font-bold">Proposals</h1>
          <div className="text-sm text-gray-400 mt-0.5">
            {proposals.length} proposal{proposals.length === 1 ? "" : "s"} sent
          </div>
        </div>
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`px-3 py-2 text-sm font-medium ${
                section === s.key ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-8 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>
      )}

      {section === "responses" && (
        <div className="px-8 py-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          ) : proposals.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <FileSignature size={32} className="mx-auto mb-3 text-gray-300" />
              <div className="text-sm">No proposals yet.</div>
              <button
                onClick={() => setSection("create")}
                className="mt-4 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium hover:bg-gray-800"
              >
                Create one
              </button>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Name</th>
                    <th className="text-left font-medium px-4 py-2.5">Date</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {proposals.map((p) => {
                    const st = STATUS_STYLES[p.status] || STATUS_STYLES.pending;
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{p.name}</div>
                          {p.company && <div className="text-xs text-gray-400">{p.company}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {formatDate(p.signedAt || p.createdAt)}
                          <div className="text-xs text-gray-400">{p.signedAt ? "Signed" : "Sent"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={p.status}
                            onChange={(e) => setStatus(p, e.target.value)}
                            className={`text-xs font-medium border rounded-full px-2.5 py-1 cursor-pointer focus:outline-none ${st.cls}`}
                          >
                            {Object.entries(STATUS_STYLES).map(([value, s]) => (
                              <option key={value} value={value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => copy(p.id, proposalUrl(p))}
                              title="Copy link"
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md px-2 py-1.5"
                            >
                              {copied === p.id ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                              {copied === p.id ? "Copied" : "Copy link"}
                            </button>
                            <a
                              href={proposalUrl(p)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open"
                              className="text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-md p-1.5"
                            >
                              <ExternalLink size={14} />
                            </a>
                            <button
                              onClick={() => remove(p)}
                              title="Delete"
                              className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md p-1.5"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {section === "create" && (
        <div className="px-8 py-6 space-y-6">
          <form onSubmit={create} className="border border-gray-200 rounded-lg p-5 max-w-3xl">
            <div className="text-sm font-semibold mb-1">Client details</div>
            <div className="text-xs text-gray-400 mb-4">
              Fill these in to generate a unique link for this lead. When they sign, it shows up in Responses.
            </div>
            <fieldset disabled={!!created} className="grid grid-cols-2 lg:grid-cols-4 gap-3 disabled:opacity-70">
              <label className="text-xs text-gray-500 font-medium space-y-1">
                <span>Client name</span>
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Joseph Abdal"
                  autoComplete="off"
                  required
                />
              </label>
              <label className="text-xs text-gray-500 font-medium space-y-1">
                <span>Company</span>
                <input
                  className={inputCls}
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  placeholder="Fort Enterprises"
                  autoComplete="off"
                />
              </label>
              <label className="text-xs text-gray-500 font-medium space-y-1">
                <span>Amount (monthly), $</span>
                <input
                  className={inputCls}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="2500"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                />
              </label>
              <label className="text-xs text-gray-500 font-medium space-y-1">
                <span>For period</span>
                <select
                  className={inputCls}
                  value={form.period}
                  onChange={(e) => setForm({ ...form, period: Number(e.target.value) })}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {periodText(n)}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <div className="flex items-center gap-3 mt-4">
              <button
                type="submit"
                disabled={creating || !!created}
                className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-60"
              >
                {creating ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                Create &amp; copy link
              </button>
              {created && (
                <button
                  type="button"
                  onClick={() => {
                    setForm(EMPTY_FORM);
                    setCreated(null);
                  }}
                  className="text-sm text-gray-500 hover:text-gray-900"
                >
                  Start a new one
                </button>
              )}
            </div>
            {created && (
              <div className="mt-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <Check size={15} className="text-green-600 shrink-0" />
                <input
                  readOnly
                  value={proposalUrl(created)}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 bg-transparent text-sm text-green-900 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => copy(`new-${created.id}`, proposalUrl(created))}
                  className="flex items-center gap-1 text-xs font-medium text-green-800 hover:bg-green-100 rounded-md px-2 py-1"
                >
                  <Copy size={13} /> {copied === `new-${created.id}` ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </form>
          <div>
            <div className="text-xs text-gray-400 mb-2">Preview — what {form.name.trim() || "the lead"} will see</div>
            <DocPreview name={form.name} amount={form.amount} period={form.period} />
          </div>
        </div>
      )}

      {section === "template" && (
        <div className="px-8 py-6">
          <DocPreview name="Joseph Abdal" amount="2500" period={3} />
        </div>
      )}
    </div>
  );
}
