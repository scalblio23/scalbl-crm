import React from "react";

// Public, static legal pages (/privacypolicy, /termsofservice) — no
// login, no CRM chrome. Both share one layout; only the text differs.
const PRIVACY_SECTIONS = [
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

const TERMS_SECTIONS = [
  {
    title: "1. Acceptance of Terms",
    paragraphs: [
      "These Terms of Service govern access to and use of our internal Customer Relationship Management (CRM) system, including any associated client portal, booking pages, and related services (the \"Service\").",
      "By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, you must not use the Service.",
    ],
  },
  {
    title: "2. Use of the Service",
    paragraphs: [
      "The Service is provided to support lead management, appointment setting, customer communications, reporting, and related service delivery for our clients.",
      "You may use the Service only for lawful, authorised business purposes and in accordance with these Terms and any applicable service agreement.",
    ],
  },
  {
    title: "3. Accounts & Access",
    paragraphs: [
      "Access to the Service is granted only to authorised users. You are responsible for keeping your login credentials secure and confidential.",
      "You must not share your account with others, and you must notify us promptly if you become aware of any unauthorised access to or use of your account.",
      "We may suspend or revoke access where we reasonably believe an account has been compromised or used in breach of these Terms.",
    ],
  },
  {
    title: "4. Client Data & Confidentiality",
    paragraphs: [
      "Client data within the Service is handled in accordance with our Privacy Policy & Data Confidentiality Statement.",
      "All leads, customer records, and associated information remain the property of the respective client, subject to applicable agreements, and are never shared or mixed with the data of other clients.",
    ],
  },
  {
    title: "5. Acceptable Use",
    paragraphs: ["When using the Service, you must not:"],
    bullets: [
      "Access, or attempt to access, data belonging to another client or any part of the Service you are not authorised to use.",
      "Use the Service to send unsolicited, misleading, or unlawful communications, including in breach of applicable spam, telemarketing, or privacy laws.",
      "Copy, export, sell, or disclose client data other than for authorised purposes.",
      "Interfere with, disrupt, or attempt to bypass the security or operation of the Service.",
      "Upload or transmit any malicious code, or content that is unlawful, defamatory, or infringes the rights of others.",
    ],
  },
  {
    title: "6. Service Availability",
    paragraphs: [
      "We aim to keep the Service available and reliable, but we do not guarantee that it will be uninterrupted, error-free, or available at all times.",
      "We may carry out maintenance, updates, or changes to the Service from time to time, and may modify or discontinue features where reasonably necessary.",
    ],
  },
  {
    title: "7. Intellectual Property",
    paragraphs: [
      "The Service, including its software, design, and content (excluding client data), is owned by us or our licensors and is protected by intellectual property laws.",
      "No rights in the Service are granted to you other than the limited right to use it in accordance with these Terms.",
    ],
  },
  {
    title: "8. Fees",
    paragraphs: [
      "Any fees for services provided through the Service are set out in the relevant client service agreement. Where those terms conflict with these Terms, the service agreement prevails to the extent of the inconsistency.",
    ],
  },
  {
    title: "9. Limitation of Liability",
    paragraphs: [
      "Nothing in these Terms excludes, restricts, or modifies any right or remedy you may have under the Australian Consumer Law or any other law that cannot lawfully be excluded.",
      "To the maximum extent permitted by law, we are not liable for any indirect or consequential loss, or for any loss of profits, revenue, data, or business opportunity, arising from or in connection with use of the Service.",
    ],
  },
  {
    title: "10. Suspension & Termination",
    paragraphs: [
      "We may suspend or terminate access to the Service if these Terms are breached, if required by law, or in accordance with the relevant service agreement.",
      "On termination, client data will be handled in accordance with our Privacy Policy & Data Confidentiality Statement and any applicable agreement.",
    ],
  },
  {
    title: "11. Changes to These Terms",
    paragraphs: [
      "We may update these Terms from time to time. The \"Last Updated\" date above shows when they were last revised. Continued use of the Service after changes take effect constitutes acceptance of the updated Terms.",
    ],
  },
  {
    title: "12. Governing Law",
    paragraphs: [
      "These Terms are governed by the laws of Australia, and any disputes will be subject to the jurisdiction of the courts of Australia.",
    ],
  },
];

function LegalPage({ title, lastUpdated, intro, sections }) {
  return (
    <div
      className="min-h-screen bg-gray-50 text-gray-900 py-12 px-4"
      style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
    >
      <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <div className="text-xs text-gray-400 mt-1">Last Updated: {lastUpdated}</div>
        <p className="mt-6 text-sm leading-relaxed text-gray-700">{intro}</p>
        {sections.map((s) => (
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

export function PrivacyPolicy() {
  return (
    <LegalPage
      title="Privacy Policy & Data Confidentiality Statement"
      lastUpdated="15 October 2026"
      intro="We are committed to maintaining the highest standards of privacy, confidentiality, and data protection for all clients using our internal Customer Relationship Management (CRM) system."
      sections={PRIVACY_SECTIONS}
    />
  );
}

export function TermsOfService() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="15 October 2026"
      intro="Please read these Terms of Service carefully. They set out the terms on which authorised users may access and use our internal Customer Relationship Management (CRM) system."
      sections={TERMS_SECTIONS}
    />
  );
}
