import React from "react";
import ReactDOM from "react-dom/client";
import SimpleCRM from "./SimpleCRM.jsx";
import BookingPage from "./BookingPage.jsx";
import "./index.css";

// No router dependency for one split: the public booking page
// (/book/:slug, contact-facing, no login) is a completely separate
// experience from the CRM itself, so a plain pathname check is enough
// — see vercel.json for the rewrite that makes /book/* load this on a
// fresh page visit in production.
const isBookingPage = window.location.pathname.startsWith("/book/");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>{isBookingPage ? <BookingPage /> : <SimpleCRM />}</React.StrictMode>
);
