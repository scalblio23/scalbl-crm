// The Scalbl proposal itself — the same document the lead sees on their
// signing link (src/ProposalPage.jsx) and the team previews in the
// Proposals tab. Only the client's name, the monthly amount and the
// period vary; everything else is fixed copy. `signBlock` is whatever
// goes under the Terms of Service (the signature box).
import React from "react";

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export function periodText(n) {
  n = Number(n) || 3;
  return `${WORDS[n]} (${n}) month${n === 1 ? "" : "s"}`;
}

export function money(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return "";
  return "$" + n.toLocaleString("en-AU", { maximumFractionDigits: 2 });
}

export function fmtDate(d) {
  if (!d) return "";
  const p = d.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Scoped under .sp-root so none of it leaks into the CRM (and Tailwind's
// reset — no list bullets, no heading sizes — doesn't flatten it).
export const PROPOSAL_CSS = `
.sp-root{--ink:#111;--blue-band:#5096e8;--blue-text:#4a90e2;--cell-blue:#bfe0f7;--cell-grey:#e7eef8;--btn:#1d5fe0;--sig-bg:#eef8d8;--sig-border:#a6c96a;--sig-text:#6b8e23;color-scheme:light}
.sp-root *,.sp-root *::before,.sp-root *::after{box-sizing:border-box}
.sp-paper{max-width:850px;margin:0 auto;background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(15,23,42,.12);padding:56px 50px 80px;font-family:Arial,"Helvetica Neue",Helvetica,sans-serif;text-align:left}
@media (max-width:640px){.sp-paper{padding:28px 18px 48px}}
.sp-eyebrow{font-size:12px;font-weight:700;color:#555;margin:0 0 50px 10px}
.sp-head{display:flex;justify-content:space-between;gap:20px;padding:0 10px}
.sp-head h1{margin:0;font-size:31px;line-height:1.02;font-weight:700;max-width:410px;letter-spacing:-.2px}
.sp-contact{display:flex;gap:28px;align-items:flex-start;font-size:10.5px;line-height:1.45;flex:none}
.sp-contact b{font-weight:700}
.sp-logo{width:80px;height:80px;background:radial-gradient(120% 90% at 30% 85%,#3a3a3a 0%,#111 38%,#000 70%);position:relative;overflow:hidden;flex:none}
.sp-logo::after{content:"";position:absolute;left:18%;top:52%;width:58%;height:3px;background:linear-gradient(90deg,transparent,#555,transparent);transform:rotate(-24deg)}
@media (max-width:640px){.sp-head{flex-direction:column}.sp-head h1{font-size:26px}}
.sp-quote{color:var(--blue-text);font-style:italic;font-weight:700;font-size:23px;line-height:1.05;margin:38px 10px 16px}
.sp-paper p{font-size:15px;line-height:1.55;margin:0 10px 12px}
.sp-paper ul{margin:0 10px 26px;padding-left:40px;font-size:15px;line-height:1.55;list-style:disc}
.sp-band{background:var(--blue-band);color:#fff;text-align:center;font-weight:700;font-size:23px;padding:22px 12px;margin:0 0 20px}
.sp-band.tight{margin-bottom:0}
.sp-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:0 0 28px}
.sp-col{display:flex;flex-direction:column}
.sp-cell{padding:10px 10px 14px;font-size:14.5px;line-height:1.5}
.sp-cell > b{display:block;font-weight:700}
.sp-cell.blue{background:var(--cell-blue)}
.sp-cell.grey{background:var(--cell-grey)}
.sp-cell.tall{min-height:142px}
@media (max-width:640px){.sp-grid3{grid-template-columns:1fr;gap:10px}}
.sp-who{color:var(--blue-text);font-weight:700;font-size:23px;margin:26px 10px 18px}
.sp-review{font-family:Inter,"Helvetica Neue",Arial,sans-serif;padding:14px 50px 6px 50px;color:#1a1a1a}
@media (max-width:640px){.sp-review{padding:10px 6px}}
.sp-r-top{display:flex;justify-content:space-between;align-items:flex-start}
.sp-r-id{display:flex;gap:12px;align-items:center}
.sp-avatar{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:600;flex:none}
.sp-avatar.photo{background:radial-gradient(circle at 50% 38%,#c9a98f 0 26%,#5e5e5e 27% 100%)}
.sp-avatar.initials{background:#f9d9e0;color:#3a1520}
.sp-r-name{font-size:15px;font-weight:500}
.sp-r-meta{font-size:13px;color:#666}
.sp-r-date{font-size:13.5px;color:#555}
.sp-stars{display:flex;gap:2px;margin:14px 0 10px}
.sp-stars span{width:21px;height:21px;background:#00b67a;display:grid;place-items:center}
.sp-stars svg{width:15px;height:15px}
.sp-r-title{font-weight:600;font-size:16px;margin:0 0 12px}
.sp-review p{margin:0 0 14px;font-size:16px;line-height:1.55}
.sp-tags{display:flex;gap:8px;margin:6px 0 18px;flex-wrap:wrap}
.sp-tags span{background:#eceaea;font-size:12.5px;padding:3px 8px;border-radius:4px;color:#333}
.sp-r-actions{display:flex;gap:22px;font-size:14px;color:#555;align-items:center;margin-bottom:20px}
.sp-tos{padding:12px 10px 0;font-size:14.5px;line-height:1.5}
.sp-tos h3{font-size:14.5px;margin:20px 0 2px;font-weight:700}
.sp-paper .sp-tos p{margin:0 0 10px;font-size:14.5px}
.sp-paper .sp-tos ul{font-size:14.5px;margin:6px 0 10px;padding-left:30px}
.sp-tos .lead{font-weight:700}
.sp-sign-block{margin:34px 0 0 0;padding:0 8px}
.sp-signer{font-size:14.5px;margin-bottom:4px}
.sp-sigbox{position:relative;width:min(100%,430px);height:105px;background:var(--sig-bg);border:1px solid var(--sig-border);display:grid;place-items:center;color:var(--sig-text);font-size:15px;font-family:Inter,Arial,sans-serif;padding:0}
button.sp-sigbox{cursor:pointer}
button.sp-sigbox:disabled{cursor:default}
.sp-sigbox img{max-width:92%;max-height:90px}
.sp-req::after{content:"*";color:#e11d48;position:absolute;right:-7px;top:-9px;font-size:16px;font-weight:700}
.sp-datebox{position:relative;margin-top:8px;width:min(100%,275px);height:24px;background:var(--sig-bg);border:1px solid var(--sig-border);display:flex;align-items:center;padding:0 4px;font-size:12px;color:var(--sig-text);font-family:Inter,Arial,sans-serif}
.sp-datebox input{border:0;background:transparent;font:inherit;color:#3f5f10;width:100%;padding:0;outline:none}
.sp-datebox span.done{color:#111}
.sp-signed-meta{font-size:11px;color:#666;margin-top:6px;font-family:Inter,Arial,sans-serif}
.sp-locked .sp-sigbox,.sp-locked .sp-datebox{background:transparent;border-color:#ccc}
`;

const STAR = (
  <svg viewBox="0 0 24 24" fill="#fff">
    <path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7L2 9.5l7.1-.6z" />
  </svg>
);

function Stars() {
  return (
    <div className="sp-stars" aria-label="5 out of 5 stars">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i}>{STAR}</span>
      ))}
    </div>
  );
}

export default function ProposalDocument({ name, amount, period, signBlock, docRef }) {
  const fullName = String(name || "").trim();
  const first = fullName.split(/\s+/)[0] || "";
  const amountText = money(amount) || "$0";
  const periodLabel = periodText(period);

  return (
    <article className="sp-paper" ref={docRef}>
      <div className="sp-eyebrow">Proposal for {first}</div>

      <div className="sp-head">
        <h1>Get Warm Leads Booked Directly Onto Your Calendar By Our Australian Inbound Calling Team</h1>
        <div className="sp-contact">
          <div>
            <b>Scalbl.io</b>
            <br />L 30 91 King
            <br />
            William St Adelaide
            <br />
            SA 5000
            <br />
            +61483926815
            <br />
            admin@scalbl.io
            <br />
            ABN 55 161 627 051
          </div>
          <div className="sp-logo" aria-hidden="true" />
        </div>
      </div>

      <div className="sp-quote">
        "We run your ads, call your leads, and create a pipeline of new opportunity in your business every month."
      </div>

      <p>
        Most businesses waste time generating leads that are never going to buy. Or worse, rely on word of mouth and
        referrals which means you have zero control over the process. What we do instead, is create a consistent
        pipeline of new opportunity coming into your business with three things.
      </p>
      <ul>
        <li>High converting ads targeted to your unique ideal client</li>
        <li>A self booking funnel designed to convert these leads into pre-booked appointments</li>
        <li>
          An in-house Australian calling team, calling your leads for you to qualify them and add them directly onto
          your calendar.
        </li>
      </ul>

      <div className="sp-band">Here's How Our Service Works</div>

      <div className="sp-grid3">
        <div className="sp-col">
          <div className="sp-cell blue">
            <b>Ad Creation &amp; Management</b>We build and manage your Facebook ad campaigns end-to-end.
          </div>
          <div className="sp-cell grey">
            <b>Call Recordings</b>Watch and listen to your leads being booked so you're fully prepared.
          </div>
          <div className="sp-cell">
            <b>3-Day Launch</b>Campaign live within three business days.
          </div>
        </div>
        <div className="sp-col">
          <div className="sp-cell blue tall">
            <b>Self Booking Funnel</b>Custom-built funnel that captures and pre-qualifies every lead.
          </div>
          <div className="sp-cell grey">
            <b>Weekly Performance Reporting</b>Track exactly how your ads and calls are performing.
          </div>
          <div className="sp-cell">
            <b>Payment terms</b>
            {amountText}/month management fee, plus a separate advertising budget of <strong>$50–$100 per day</strong>{" "}
            or <strong>$6,000 initial payment</strong> covering{" "}
            <strong>{periodLabel} of management services</strong>
          </div>
        </div>
        <div className="sp-col">
          <div className="sp-cell blue">
            <b>Warm Lead Calling</b>Our Australian team calls new leads and books them directly into your calendar.
          </div>
          <div className="sp-cell grey">
            <b>CRM Integration &amp; Build</b>We plug directly into your GoHighLevel or existing system and assist with
            the build out,
          </div>
        </div>
      </div>

      <div className="sp-band tight">Client Testimonials</div>

      <div className="sp-who">Brian Kearney - Redwood Finance</div>
      <div className="sp-review">
        <div className="sp-r-top">
          <div className="sp-r-id">
            <div className="sp-avatar photo" aria-hidden="true" />
            <div>
              <div className="sp-r-name">Brian Kearney</div>
              <div className="sp-r-meta">AU • 1 review</div>
            </div>
          </div>
          <div className="sp-r-date">7 Aug 2025</div>
        </div>
        <Stars />
        <div className="sp-r-title">I have been working with Henry for a...</div>
        <p>
          I have been working with Henry for a few years now. Very helpful in showing you the step by step breakdown of
          what is needed to run a profitable business. If you are looking to elevate your client acquisition, I have no
          problem recommending the Incubator
        </p>
        <div className="sp-tags">
          <span>4 August 2025</span>
          <span>Unprompted review</span>
        </div>
        <div className="sp-r-actions">
          <span>👍 Useful</span>
          <span>⤴ Share</span>
          <span>⚑</span>
        </div>
      </div>

      <div className="sp-who">Jordan Burkett - My Reno Quotes NZ</div>
      <div className="sp-review">
        <div className="sp-r-top">
          <div className="sp-r-id">
            <div className="sp-avatar initials" aria-hidden="true">
              JB
            </div>
            <div>
              <div className="sp-r-name">Jordan Burkett</div>
              <div className="sp-r-meta">NZ • 1 review</div>
            </div>
          </div>
          <div className="sp-r-date">7 Aug 2025</div>
        </div>
        <Stars />
        <div className="sp-r-title">$111k just last month!!!</div>
        <p>
          I have been working here with Henry and the team for over a year and a half now, when I started I was doing
          about $2-3k per month with inconsistent leads, sales and cash.
        </p>
        <p>Fast forward to now where just last month I did $111k revenue, running a team and working with over 80 clients,</p>
        <p>
          The bridge was learning the skills/strategies and getting everything reviewed from Henry as I was growing and
          scaling, 100% recommend these guys!! I am still working with him and the team today
        </p>
        <div className="sp-tags">
          <span>7 August 2025</span>
          <span>Unprompted review</span>
        </div>
        <div className="sp-r-actions">
          <span>👍 Useful</span>
          <span>⤴ Share</span>
          <span>⚑</span>
        </div>
      </div>

      <div className="sp-band" style={{ marginTop: 20 }}>
        Terms of Service
      </div>

      <div className="sp-tos">
        <p className="lead">
          Services Provided Henry Fortunatow (Scalbl.io) will provide advertising and appointment-setting services
          ("Services") as agreed upon in writing or electronically between both parties.
        </p>

        <h3>Payment Authorization</h3>
        <p>
          By engaging our services, the Client agrees to either a{" "}
          <strong>monthly management fee of {amountText}</strong>, plus a separate advertising budget of{" "}
          <strong>$50–$100 per day</strong>, or a <strong>one-time payment of $6,000 covering {periodLabel} of service</strong>
          . Advertising spend is separate from the $6,000 package and is paid by the Client.
        </p>

        <h3 style={{ marginTop: 28 }}>Refunds</h3>
        <p>All payments are non-refundable once services for that period have been rendered or campaigns have launched.</p>

        <h3>
          Client Responsibilities <span style={{ fontWeight: 700 }}>The Client agrees to</span>:
        </h3>
        <ul>
          <li>Provide accurate business information, access to ad accounts, and CRM systems as required.</li>
          <li>
            Respond promptly to communication and provide materials (logos, testimonials, media, etc.) in a timely
            manner.
          </li>
        </ul>

        <h3>Limitation of Liability</h3>
        <p>
          The Company shall not be liable for indirect, incidental, or consequential damages arising from campaign
          performance or service delivery.
        </p>

        <h3>Agreement Acceptance</h3>
        <p>
          By proceeding with payment or confirming service initiation in writing, the Client acknowledges and agrees to
          these Terms of Service and authorizes the Company to charge the agreed amount.
        </p>
      </div>

      {signBlock}
    </article>
  );
}

// The empty signature/date boxes, for previews where nobody signs.
export function PlaceholderSignBlock({ name }) {
  return (
    <div className="sp-sign-block">
      <div className="sp-signer">{name}</div>
      <div className="sp-sigbox sp-req">
        <span>✎ Signature</span>
      </div>
      <div className="sp-datebox sp-req">
        <span>Select date</span>
      </div>
    </div>
  );
}
