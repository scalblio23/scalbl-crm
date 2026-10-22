import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// Everything is loaded on demand: the public booking page downloads only
// the widget (a few KB), never the CRM's tabs, charts or phone code —
// and the CRM never needs the booking widget.
const SimpleCRM = lazy(() => import("./SimpleCRM.jsx"));
const BookingWidget = lazy(() => import("./BookingWidget.jsx"));
const PrivacyPolicy = lazy(() => import("./LegalPages.jsx").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfService = lazy(() => import("./LegalPages.jsx").then((m) => ({ default: m.TermsOfService })));
const ProposalPage = lazy(() => import("./ProposalPage.jsx"));

// No router dependency — the app is a single mounted component, and
// the only other pages are public routes that render with no CRM
// chrome and no login: a booking widget link (/book/<slug>), a lead's
// proposal signing link (/proposal/<token>), the privacy policy
// (/privacypolicy) and the terms of service (/termsofservice).
// Anything else falls through to the normal CRM.
const bookMatch = window.location.pathname.match(/^\/book\/([^/]+)\/?$/);
const proposalMatch = window.location.pathname.match(/^\/proposal\/([^/]+)\/?$/);
const isPrivacyPolicy = /^\/privacypolicy\/?$/i.test(window.location.pathname);
const isTermsOfService = /^\/termsofservice\/?$/i.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      {bookMatch ? (
        <BookingWidget slug={bookMatch[1]} />
      ) : proposalMatch ? (
        <ProposalPage token={proposalMatch[1]} />
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
