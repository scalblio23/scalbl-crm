// Daily lead counts for a client's Meta ad account, for the CSM tab's
// 30-day leads chart. Reads the Marketing API with META_ACCESS_TOKEN —
// a long-lived token (ideally a Business Manager system user's) with
// ads_read on the client ad accounts.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";
// Overridable for local testing against a stand-in API.
const GRAPH_BASE = process.env.META_GRAPH_BASE || "https://graph.facebook.com";
export const LEAD_DAYS = 30;

export const metaConfigured = () => Boolean(process.env.META_ACCESS_TOKEN);

// "…adsmanager…?act=1234…" → "1234"
export function adAccountIdFrom(url) {
  return /[?&#]act=(\d+)/.exec(url || "")?.[1] || null;
}

// YYYY-MM-DD for "today" where the business is (the ad accounts report
// in Australian time), and the 30 days ending then.
export function leadDayRange(now = new Date(), timeZone = "Australia/Sydney") {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now); // YYYY-MM-DD
  const days = [];
  const d = new Date(`${today}T00:00:00Z`);
  for (let i = LEAD_DAYS - 1; i >= 0; i--) {
    days.push(new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return days;
}

// [{ date, leads }] for each of the last 30 days (0 where none), counting
// Meta's "lead" action — only from campaigns whose name contains
// `keyword`, when one is set (the tracker's ad account rule).
export async function fetchDailyLeads({ accountId, keyword = "", fetchImpl = globalThis.fetch, now } = {}) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error("Meta isn't connected (META_ACCESS_TOKEN not set)."), { code: "not-configured" });
  const days = leadDayRange(now);
  const params = new URLSearchParams({
    fields: "actions",
    level: "account",
    time_increment: "1",
    time_range: JSON.stringify({ since: days[0], until: days[days.length - 1] }),
    action_breakdowns: "action_type",
    limit: "100",
    access_token: token,
  });
  if (keyword.trim()) {
    params.set("filtering", JSON.stringify([{ field: "campaign.name", operator: "CONTAIN", value: keyword.trim() }]));
  }
  const byDay = new Map();
  let url = `${GRAPH_BASE}/${GRAPH_VERSION}/act_${accountId}/insights?${params}`;
  for (let page = 0; url && page < 5; page++) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const msg = body.error?.message || `Meta returned ${res.status}`;
      throw Object.assign(new Error(msg), { code: "meta-error" });
    }
    for (const row of body.data || []) {
      const lead = (row.actions || []).find((a) => a.action_type === "lead");
      byDay.set(row.date_start, (byDay.get(row.date_start) || 0) + Number(lead?.value || 0));
    }
    url = body.paging?.next || null;
  }
  return days.map((date) => ({ date, leads: byDay.get(date) || 0 }));
}
