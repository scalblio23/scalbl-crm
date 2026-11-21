import React from "react";

// Where a calendar's calls happen (Calendar settings → Location), shown
// with its logo on the public booking page.
export const MEETING_LOCATIONS = [
  {
    value: "zoom",
    label: "Zoom",
    note: "This meeting is on Zoom, please choose a time where you will be in a quiet place of work.",
  },
  {
    value: "gmeet",
    label: "Google Meet",
    note: "This meeting is on Google Meet, please choose a time where you will be in a quiet place of work.",
  },
  {
    value: "teams",
    label: "Microsoft Teams",
    note: "This meeting is on Microsoft Teams, please choose a time where you will be in a quiet place of work.",
  },
  {
    value: "phone",
    label: "Phone call",
    note: "This is a phone call to the number you provide, please choose a time where you will be in a quiet place.",
  },
];

export const meetingLocation = (value) => MEETING_LOCATIONS.find((l) => l.value === value) || null;

export function LocationLogo({ value, size = 24 }) {
  const s = { width: size, height: size, flexShrink: 0 };
  if (value === "zoom")
    return (
      <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
        <defs>
          <linearGradient id="zoom-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3B7BFF" />
            <stop offset="1" stopColor="#0B5CFF" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="14" fill="url(#zoom-g)" />
        <text x="24" y="29.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="14.5" fill="#fff" letterSpacing="-0.3">
          zoom
        </text>
      </svg>
    );
  if (value === "gmeet")
    return (
      <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
        <path d="M27 24l5.6 6.4 7.6 4.8 1.3-11.2-1.3-10.9-7.7 4.3z" fill="#00832d" />
        <path d="M4 34.2V42c0 1.8 1.4 3.2 3.2 3.2H15l1.6-5.8L15 34.2l-5.4-1.6z" fill="#0066da" />
        <path d="M15 4.8L4 15.8l5.6 1.6 5.4-1.6 1.6-5.1z" fill="#e94235" />
        <path d="M4 34.2h11V15.8H4z" fill="#2684fc" />
        <path d="M44.3 9.9l-4.1 3.2v22.1l4.1 3.3c.6.5 1.5 0 1.5-.8V10.7c0-.8-.9-1.3-1.5-.8zM27 24v10.2H15v11h17.7c1.8 0 3.2-1.4 3.2-3.2v-7.1z" fill="#00ac47" />
        <path d="M32.7 4.8H15v11h12V24l8.9-7.4V8c0-1.8-1.4-3.2-3.2-3.2z" fill="#ffba00" />
      </svg>
    );
  if (value === "teams")
    return (
      <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
        <circle cx="36" cy="12" r="5" fill="#5059C9" />
        <path d="M30 19h13c1.1 0 2 .9 2 2v10a8 8 0 01-15 3.9z" fill="#5059C9" />
        <circle cx="24" cy="10" r="7" fill="#7B83EB" />
        <path d="M14 19h20c1.1 0 2 .9 2 2v12a12 12 0 01-22 6.6z" fill="#7B83EB" />
        <rect x="3" y="14" width="24" height="24" rx="3" fill="#4B53BC" />
        <path d="M9 20h12v3.4h-4.2V33h-3.6v-9.6H9z" fill="#fff" />
      </svg>
    );
  if (value === "phone")
    return (
      <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
        <rect width="48" height="48" rx="24" fill="#16A34A" />
        <path
          d="M19.3 13.5c-.6-1.4-2.1-2.1-3.5-1.6l-2.4.8c-1.3.4-2.1 1.7-2 3 .9 11.8 10.1 21 21.9 21.9 1.3.1 2.6-.7 3-2l.8-2.4c.5-1.4-.2-2.9-1.6-3.5l-4.4-1.9c-1.2-.5-2.6-.2-3.4.8l-1.3 1.6a16 16 0 01-7.4-7.4l1.6-1.3c1-.8 1.3-2.2.8-3.4z"
          fill="#fff"
        />
      </svg>
    );
  return null;
}
