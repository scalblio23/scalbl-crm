import React from "react";

// Public, static page served at /privacypolicy — no login, no CRM chrome.
const SECTIONS = [
  {
    title: "1. Client Data Privacy",
    paragraphs: [
      "All client information, including leads, contact details, customer records, communications, and associated business data, is treated as strictly private and confidential.",
      "All lead data remains confidential to the respective client and is never shared, pooled, mixed, or mingled with the data of other clients.",
      "Each client's information is maintained separately within our CRM environment to preserve data confidentiality and prevent unauthorised cross-client access.",
    ],
  },
  {
    title: "2. Restricted Staff Access",
    paragraphs: [
      "Access to client data is strictly limited to authorised staff members who require the information to perform their assigned responsibilities.",
      "We apply role-based access controls where appropriate to ensure that only relevant personnel can access, manage, or process client information.",
      "All authorised staff are expected to maintain strict confidentiality when handling client data.",
    ],
  },
  {
    title: "3. Data Ownership & Usage",
    paragraphs: [
      "All leads, customer records, and associated information provided by or generated on behalf of a client remain the property of that respective client, subject to applicable agreements.",
      "Client data is used exclusively for authorised business purposes, including lead management, appointment setting, customer communications, reporting, and service delivery.",
      "Client data is never sold, traded, distributed, or used for the benefit of another client.",
    ],
  },
  {
    title: "4. Data Security",
    paragraphs: [
      "We implement appropriate technical and organisational safeguards designed to protect client information against unauthorised access, disclosure, alteration, misuse, or loss.",
      "Access permissions are managed according to operational requirements, and confidential information is handled in accordance with applicable Australian privacy and data protection obligations.",
    ],
  },
  {
    title: "5. Confidentiality Commitment",
    paragraphs: [
      "We recognise that lead databases and customer information are valuable commercial assets.",
      "Our CRM operates under a strict client confidentiality principle:",
    ],
    bullets: [
      "Client lead databases are kept separate and confidential.",
      "No cross-client sharing or mixing of lead information is permitted.",
      "Access is restricted to a limited number of authorised staff.",
      "Data is processed only for legitimate, authorised client services.",
      "Client information is not sold or disclosed to unrelated third parties for marketing purposes.",
    ],
  },
  {
    title: "6. Data Retention & Removal",
    paragraphs: [
      "Client information is retained only for as long as reasonably necessary to fulfil service obligations, meet contractual requirements, or comply with applicable legal obligations.",
      "Clients may request access to, correction of, or deletion of their information, subject to applicable legal and contractual requirements.",
    ],
  },
  {
    title: "7. Our Commitment",
    paragraphs: [
      "Your leads are your leads. Your data is your data.",
      "We are committed to ensuring that every client's information remains private, securely managed, separately maintained, and accessible only to authorised personnel directly involved in delivering their services.",
    ],
  },
];

export default function PrivacyPolicy() {
  return (
    <div
      className="min-h-screen bg-gray-50 text-gray-900 py-12 px-4"
      style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
    >
      <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold tracking-tight">Privacy Policy &amp; Data Confidentiality Statement</h1>
        <div className="text-xs text-gray-400 mt-1">Last Updated: 15 October 2026</div>
        <p className="mt-6 text-sm leading-relaxed text-gray-700">
          We are committed to maintaining the highest standards of privacy, confidentiality, and data protection for
          all clients using our internal Customer Relationship Management (CRM) system.
        </p>
        {SECTIONS.map((s) => (
          <section key={s.title} className="mt-8">
            <h2 className="text-base font-semibold">{s.title}</h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="mt-2 text-sm leading-relaxed text-gray-700">
                {p}
              </p>
            ))}
            {s.bullets && (
              <ul className="mt-2 list-disc pl-6 space-y-1 text-sm leading-relaxed text-gray-700">
                {s.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <div className="mt-10 pt-4 border-t border-gray-100 text-xs">
          <a href="/" className="text-gray-400 hover:text-gray-600">
            ← Back to Scalbl CRM
          </a>
        </div>
      </div>
    </div>
  );
}
