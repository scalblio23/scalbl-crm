import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import SimpleCRM from "./SimpleCRM.jsx";

// The public booking page never needs the CRM's tabs, and the CRM never
// needs the booking widget — the widget loads only on its own page.
const BookingWidget = lazy(() => import("./BookingWidget.jsx"));
const PrivacyPolicy = lazy(() => import("./LegalPages.jsx").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfService = lazy(() => import("./LegalPages.jsx").then((m) => ({ default: m.TermsOfService })));

// No router dependency — the app is a single mounted component, and
// the only other pages are public routes that render with no CRM
// chrome and no login: a booking widget link (/book/<slug>), the
// privacy policy (/privacypolicy) and the terms of service
// (/termsofservice). Anything else falls through to the normal CRM.
const bookMatch = window.location.pathname.match(/^\/book\/([^/]+)\/?$/);
const isPrivacyPolicy = /^\/privacypolicy\/?$/i.test(window.location.pathname);
const isTermsOfService = /^\/termsofservice\/?$/i.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {bookMatch ? (
        <BookingWidget slug={bookMatch[1]} />
      ) : isPrivacyPolicy ? (
        <PrivacyPolicy />
      ) : isTermsOfService ? (
        <TermsOfService />
      ) : (
        <SimpleCRM />
      )}
    </Suspense>
  </React.StrictMode>
);
