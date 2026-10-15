import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import SimpleCRM from "./SimpleCRM.jsx";

// The public booking page never needs the CRM's tabs, and the CRM never
// needs the booking widget — the widget loads only on its own page.
const BookingWidget = lazy(() => import("./BookingWidget.jsx"));
const PrivacyPolicy = lazy(() => import("./PrivacyPolicy.jsx"));

// No router dependency — the app is a single mounted component, and
// the only other pages are public routes that render with no CRM
// chrome and no login: a booking widget link (/book/<slug>) and the
// privacy policy (/privacypolicy). Anything else falls through to the
// normal CRM.
const bookMatch = window.location.pathname.match(/^\/book\/([^/]+)\/?$/);
const isPrivacyPolicy = /^\/privacypolicy\/?$/i.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {bookMatch ? <BookingWidget slug={bookMatch[1]} /> : isPrivacyPolicy ? <PrivacyPolicy /> : <SimpleCRM />}
    </Suspense>
  </React.StrictMode>
);
