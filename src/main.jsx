import React from "react";
import ReactDOM from "react-dom/client";
import SimpleCRM from "./SimpleCRM.jsx";
import BookingWidget from "./BookingWidget.jsx";
import "./index.css";

// No router dependency — the app is a single mounted component, and
// the only other page is this one public route: a booking widget
// link (/book/<slug>) that has to render with no CRM chrome and no
// login. Anything else falls through to the normal CRM.
const bookMatch = window.location.pathname.match(/^\/book\/([^/]+)\/?$/);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>{bookMatch ? <BookingWidget slug={bookMatch[1]} /> : <SimpleCRM />}</React.StrictMode>
);
