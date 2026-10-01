import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// The public booking page and the CRM never share a page load, so each
// only downloads its own code.
const SimpleCRM = lazy(() => import("./SimpleCRM.jsx"));
const BookingWidget = lazy(() => import("./BookingWidget.jsx"));

// No router dependency — the app is a single mounted component, and
// the only other page is this one public route: a booking widget
// link (/book/<slug>) that has to render with no CRM chrome and no
// login. Anything else falls through to the normal CRM.
const bookMatch = window.location.pathname.match(/^\/book\/([^/]+)\/?$/);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={null}>{bookMatch ? <BookingWidget slug={bookMatch[1]} /> : <SimpleCRM />}</Suspense>
  </React.StrictMode>
);
