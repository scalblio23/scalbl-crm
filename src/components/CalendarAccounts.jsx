import React, { useEffect, useState } from "react";
import { Globe, Mail, Plus, CheckCircle2 } from "lucide-react";
import Dropdown from "./Dropdown";
import { api } from "../lib/api";

const PROVIDERS = {
  google: { name: "Google", Icon: Globe },
  outlook: { name: "Outlook", Icon: Mail },
};

// "Also check these calendars for clashes" — ticked calendars' busy
// time blocks off slots on the booking calendar being edited.
export function ClashCalendarChecklist({ title, options, selected, onChange, empty = "No other calendars on this account." }) {
  const sel = new Set(selected.map(String));
  return (
    <div>
      {title && <div className="text-xs font-medium mb-1.5 text-gray-500">{title}</div>}
      {options.length === 0 ? (
        <p className="text-xs text-gray-400">{empty}</p>
      ) : (
        <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sel.has(String(o.value))}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected.filter((v) => String(v) !== String(o.value)), o.value]
                      : selected.filter((v) => String(v) !== String(o.value))
                  )
                }
                className="w-4 h-4 rounded border-gray-300"
              />
              <span className="truncate">{o.label}</span>
              {o.writable === false && <span className="text-[11px] text-gray-400 shrink-0">view only</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// "primary" is the server's shorthand for an account's main calendar
// (see server/db.js's calendar_connections) — swapped for that
// calendar's real id once the account's calendar list has loaded.
function resolvePrimary(ids, list) {
  const primaryId = list.find((c) => c.primary)?.id;
  return [...new Set(ids.map((id) => (id === "primary" && primaryId ? primaryId : id)))];
}

// Calendar settings → Integrate: every Google/Outlook account signed in
// on this booking calendar (any number of each), which of their
// calendars block time, and the one place bookings are added to —
// "Add calls to calendar" → Google or Outlook → account → calendar.
// `onSave(patch)` PATCHes the calendar; `onDisconnect(connection)` signs
// an account out.
export default function CalendarAccounts({ calendar, onSave, onDisconnect }) {
  const connections = calendar.connections || [];
  const connectionKey = connections.map((c) => c.id).join(",");

  // Each account's calendars, keyed by connection id:
  // { loading, error, list: [{ id, summary, primary, writable }] }.
  const [calendarsByConnection, setCalendarsByConnection] = useState({});
  useEffect(() => {
    let cancelled = false;
    setCalendarsByConnection({});
    for (const c of connections) {
      setCalendarsByConnection((m) => ({ ...m, [c.id]: { loading: true, error: "", list: [] } }));
      api
        .get(`/api/calendar-${c.provider}-calendars?calendarId=${calendar.id}&connectionId=${c.id}&all=1`)
        .then((list) => !cancelled && setCalendarsByConnection((m) => ({ ...m, [c.id]: { loading: false, error: "", list } })))
        .catch(
          (err) =>
            !cancelled &&
            setCalendarsByConnection((m) => ({
              ...m,
              [c.id]: { loading: false, error: err.message || "Could not load this account's calendars.", list: [] },
            }))
        );
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.id, connectionKey]);

  const target = connections.find((c) => c.id === calendar.bookingConnectionId) || null;
  const targetCalendars = target ? calendarsByConnection[target.id] || { loading: true, list: [] } : null;
  const targetCalendarValue = target
    ? calendar.bookingCalendarId && calendar.bookingCalendarId !== "primary"
      ? calendar.bookingCalendarId
      : targetCalendars.list.find((c) => c.primary)?.id || "primary"
    : "";
  const providersConnected = Object.keys(PROVIDERS).filter((p) => connections.some((c) => c.provider === p));

  // Picking a provider or account saves straight away (that account's
  // main calendar), so bookings always have somewhere valid to go.
  const chooseProvider = (provider) => {
    if (provider === "none") return onSave({ bookingConnectionId: null, bookingCalendarId: null });
    if (target?.provider === provider) return;
    const first = connections.find((c) => c.provider === provider);
    if (first) onSave({ bookingConnectionId: first.id, bookingCalendarId: null });
  };

  const accountSection = (provider) => {
    const { name, Icon } = PROVIDERS[provider];
    const accounts = connections.filter((c) => c.provider === provider);
    return (
      <div className="space-y-3">
        <h2 className="text-base font-bold pt-4">{name} accounts</h2>
        <p className="text-sm text-gray-500">
          {provider === "google"
            ? "Sign in to as many Google accounts as you need — busy time on the calendars ticked under each one blocks off slots here."
            : "Microsoft 365 or Outlook.com accounts, as many as you need — busy time on the calendars ticked under each one blocks off slots here."}
        </p>
        {accounts.map((c) => {
          const state = calendarsByConnection[c.id] || { loading: true, error: "", list: [] };
          const isTarget = c.id === calendar.bookingConnectionId;
          // The calendar bookings go to always counts, so it isn't offered.
          const options = state.list
            .filter((o) => !(isTarget && o.id === targetCalendarValue))
            .map((o) => ({ value: o.id, label: o.summary, writable: o.writable }));
          return (
            <div key={c.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.email || `${name} account`}</p>
                  {isTarget && (
                    <p className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                      <CheckCircle2 size={12} /> Calls are added to this account
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onDisconnect(c)}
                  className="text-sm text-red-600 hover:text-red-700 font-medium shrink-0"
                >
                  Disconnect
                </button>
              </div>
              {state.error ? (
                <p className="text-xs text-red-600">
                  {state.error} If this keeps happening, disconnect this account and sign in to it again.
                </p>
              ) : state.loading ? (
                <p className="text-xs text-gray-400">Loading calendars…</p>
              ) : (
                <ClashCalendarChecklist
                  title={isTarget ? "Also check these calendars for clashes" : "Check these calendars for clashes"}
                  options={options}
                  selected={resolvePrimary(c.clashCalendarIds, state.list)}
                  onChange={(calendarIds) => onSave({ connectionClash: { connectionId: c.id, calendarIds } })}
                />
              )}
            </div>
          );
        })}
        <button
          onClick={() => {
            window.location.href = `/api/calendar-${provider}-connect?calendarId=${calendar.id}`;
          }}
          className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-sm px-4 py-2.5 rounded-lg font-medium"
        >
          {accounts.length ? <Plus size={15} /> : <Icon size={15} />}
          {accounts.length ? `Add another ${name} account` : `Connect with ${name}`}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h2 className="text-base font-bold">Add calls to calendar</h2>
        <p className="text-sm text-gray-500">
          Booked calls are added to exactly one calendar. Pick Google or Outlook, then the account, then the calendar.
        </p>
        {connections.length === 0 ? (
          <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg px-4 py-3">
            Connect a Google or Outlook account below first.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1.5 text-gray-500">Provider</label>
              <Dropdown
                value={target ? target.provider : "none"}
                onChange={chooseProvider}
                options={[
                  ...providersConnected.map((p) => ({ value: p, label: PROVIDERS[p].name })),
                  { value: "none", label: "Don't add calls" },
                ]}
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5 text-gray-500">Account</label>
              <Dropdown
                value={target ? target.id : ""}
                onChange={(id) => id !== target?.id && onSave({ bookingConnectionId: id, bookingCalendarId: null })}
                options={target ? connections.filter((c) => c.provider === target.provider).map((c) => ({ value: c.id, label: c.email || PROVIDERS[c.provider].name })) : []}
                placeholder="—"
                disabled={!target}
                searchable
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5 text-gray-500">Calendar</label>
              <Dropdown
                value={targetCalendarValue}
                onChange={(bookingCalendarId) => onSave({ bookingConnectionId: target.id, bookingCalendarId })}
                options={
                  !target
                    ? []
                    : targetCalendars.list.some((o) => o.writable !== false)
                    ? targetCalendars.list.filter((o) => o.writable !== false).map((o) => ({ value: o.id, label: o.summary }))
                    : [{ value: targetCalendarValue, label: targetCalendars.loading ? "Loading…" : "Main calendar" }]
                }
                placeholder="—"
                disabled={!target || targetCalendars.loading}
                searchable
              />
            </div>
          </div>
        )}
        {connections.length > 0 && !target && (
          <p className="text-xs text-amber-700">Calls aren&apos;t being added to any calendar right now.</p>
        )}
      </div>
      {accountSection("google")}
      {accountSection("outlook")}
    </div>
  );
}
