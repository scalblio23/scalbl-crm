import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Search } from "lucide-react";

// A fully custom-rendered dropdown — the actual fix for "dropdowns
// look like grey default UI". A native <select>'s closed box can be
// styled with CSS, but the moment it's opened the browser renders its
// options list as an unstyled OS popup no matter what classes are on
// the element — that's the "grey default UI" this replaces. Here the
// options panel is a normal absolutely-positioned <div> we fully
// control, styled like every other popover in the app (white bg,
// gray-200 border, rounded-lg, shadow-lg — see the column-settings
// popover in SimpleCRM.jsx for the same click-catcher + popover
// pattern this borrows).
//
// `options`: [{ value, label }]. `searchable` adds a filter input at
// the top of the panel — meant for long lists (e.g. the ~400-entry
// IANA timezone list).
export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable = false,
  disabled = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
    if (!open) setQuery("");
  }, [open, searchable]);

  const selected = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none bg-white text-left focus:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed hover:border-gray-300"
      >
        <span className={selected ? "text-gray-900" : "text-gray-400"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} className={`text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            {searchable && (
              <div className="p-2 border-b border-gray-100">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
                    placeholder="Search…"
                    className="w-full border border-gray-200 rounded-md pl-7 pr-2 py-1.5 text-sm outline-none focus:border-gray-400"
                  />
                </div>
              </div>
            )}
            <div className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">No matches</div>}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 ${
                    o.value === value ? "font-medium text-gray-900 bg-gray-50" : "text-gray-700"
                  }`}
                >
                  {o.label}
                  {o.value === value && <Check size={14} className="text-gray-500 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
