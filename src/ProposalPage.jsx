// A lead's proposal signing link — /proposal/<token>. No login and no
// CRM chrome, same as the booking widget. The lead reads the proposal,
// draws or types a signature, picks the date and signs; that lands in
// the Proposals tab's Responses as "Signed" (api/proposal-public.js).
import React, { useEffect, useRef, useState } from "react";
import ProposalDocument, { PROPOSAL_CSS, fmtDate } from "./components/ProposalDocument.jsx";

const API_BASE = import.meta.env.VITE_CALL_SERVER_URL || "";

const PAGE_CSS = `
html,body{margin:0}
body{background:#f3f5f9}
.sp-root{font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:#1f2937;min-height:100vh;background:#f3f5f9}
.sp-root button{font:inherit;cursor:pointer}
.sp-root :focus-visible{outline:2px solid #1d5fe0;outline-offset:2px}
.sp-topbar{position:sticky;top:0;z-index:20;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;padding-top:calc(8px + env(safe-area-inset-top,0px))}
.sp-topbar .t1{font-size:13px;font-weight:600;line-height:1.3}
.sp-topbar .t2{font-size:12px;opacity:.85}
.sp-kebab{width:30px;height:30px;border-radius:6px;border:0;background:#fff;color:#111;font-weight:700;font-size:16px;line-height:1}
.sp-menu{position:absolute;right:12px;top:calc(46px + env(safe-area-inset-top,0px));background:#fff;color:#1f2937;border:1px solid #dbe3ef;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;min-width:200px}
.sp-menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:9px 12px;border-radius:6px;color:inherit;font-size:14px}
.sp-menu button:hover{background:#e8f0ff;color:#1e3a8a}
.sp-btn{border:1px solid #dbe3ef;background:#fff;color:#1f2937;border-radius:6px;padding:7px 12px;font-size:13px;font-weight:500}
.sp-btn.primary{background:#1d5fe0;border-color:#1d5fe0;color:#fff}
.sp-btn:disabled{opacity:.6;cursor:default}
.sp-banner-wrap{max-width:900px;margin:12px auto 0;padding:0 12px}
.sp-banner{max-width:850px;margin:0 auto;background:#f4f8ff;border:2px solid #c9dafc;border-radius:8px;display:flex;align-items:center;gap:10px;padding:8px 8px 8px 10px;color:#1e3a8a}
.sp-banner .flag{width:28px;height:28px;border-radius:6px;background:#dbe7ff;display:grid;place-items:center;flex:none}
.sp-banner .msg{flex:1;font-size:13px}
.sp-banner .msg b{font-weight:500;color:#1d5fe0}
.sp-banner.done{background:#f0f9e8;border-color:#c5e3a4;color:#3f6212}
.sp-banner.done .flag{background:#dcf1c4}
.sp-banner .sp-btn.primary{white-space:nowrap}
.sp-paper-wrap{padding:16px 12px 60px}
.sp-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
.sp-dialog{background:#fff;color:#1f2937;border-radius:12px;width:min(560px,100%);padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.3)}
.sp-dialog h2{margin:0 0 12px;font-size:17px;font-weight:600}
.sp-tabs{display:flex;gap:4px;margin-bottom:10px}
.sp-tabs button{border:0;background:none;padding:6px 12px;border-radius:6px;color:#64748b;font-weight:500}
.sp-tabs button[aria-selected="true"]{background:#e8f0ff;color:#1e3a8a}
.sp-pad{border:1px dashed #dbe3ef;border-radius:8px;background:#fff;position:relative}
.sp-pad canvas{display:block;width:100%;height:180px;touch-action:none;cursor:crosshair}
.sp-pad .line{position:absolute;left:24px;right:24px;bottom:42px;border-bottom:1px solid #d4d4d4;pointer-events:none}
.sp-typed input{width:100%;font:inherit;font-size:15px;padding:9px 10px;border:1px solid #dbe3ef;border-radius:6px;margin-bottom:10px;background:#fff;color:#111}
.sp-typed .preview{height:120px;border:1px dashed #dbe3ef;border-radius:8px;background:#fff;display:grid;place-items:center;font-family:"Dancing Script",cursive;font-size:44px;color:#111;overflow:hidden}
.sp-dialog .row{display:flex;justify-content:space-between;gap:8px;margin-top:14px;flex-wrap:wrap}
.sp-consent{font-size:12px;color:#64748b;margin-top:10px;line-height:1.45}
.sp-toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:#111827;color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;z-index:60;max-width:90vw}
.sp-center{max-width:520px;margin:80px auto;padding:0 16px;text-align:center;color:#475569;font-size:15px}
@media print{.sp-topbar,.sp-banner-wrap,.sp-toast{display:none!important}.sp-paper{box-shadow:none!important}body,.sp-root{background:#fff!important}}
`;

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Dancing+Script:wght@600&display=swap";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function SignatureModal({ defaultName, onCancel, onAccept, onError }) {
  const canvasRef = useRef(null);
  const drawn = useRef(false);
  const down = useRef(false);
  const last = useRef(null);
  const [tab, setTab] = useState("draw");
  const [typed, setTyped] = useState(defaultName || "");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const pos = (e) => {
    const pad = canvasRef.current;
    const r = pad.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * pad.width) / r.width, y: ((e.clientY - r.top) * pad.height) / r.height };
  };
  const resetPad = () => {
    const pad = canvasRef.current;
    pad?.getContext("2d").clearRect(0, 0, pad.width, pad.height);
    drawn.current = false;
  };

  const trimmedImage = () => {
    const c = document.createElement("canvas");
    if (tab === "draw") {
      const pad = canvasRef.current;
      if (!drawn.current) return null;
      const ctx = pad.getContext("2d");
      const w = pad.width;
      const h = pad.height;
      const d = ctx.getImageData(0, 0, w, h).data;
      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < h; y += 2)
        for (let x = 0; x < w; x += 2) {
          if (d[(y * w + x) * 4 + 3] > 0) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      if (maxX <= minX) return null;
      const pdg = 12;
      minX = Math.max(0, minX - pdg);
      minY = Math.max(0, minY - pdg);
      maxX = Math.min(w, maxX + pdg);
      maxY = Math.min(h, maxY + pdg);
      const sw = maxX - minX;
      const sh = maxY - minY;
      const scale = Math.min(1, 360 / sw, 120 / sh);
      c.width = Math.round(sw * scale);
      c.height = Math.round(sh * scale);
      c.getContext("2d").drawImage(pad, minX, minY, sw, sh, 0, 0, c.width, c.height);
    } else {
      const t = typed.trim();
      if (!t) return null;
      c.width = 420;
      c.height = 110;
      const g = c.getContext("2d");
      g.fillStyle = "#111";
      g.textBaseline = "middle";
      g.textAlign = "center";
      let size = 56;
      g.font = `600 ${size}px "Dancing Script", cursive`;
      while (g.measureText(t).width > 400 && size > 20) {
        size -= 2;
        g.font = `600 ${size}px "Dancing Script", cursive`;
      }
      g.fillText(t, 210, 58);
    }
    return c.toDataURL("image/png");
  };

  return (
    <div className="sp-modal" role="dialog" aria-modal="true" aria-labelledby="sp-mTitle" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sp-dialog">
        <h2 id="sp-mTitle">Add your signature</h2>
        <div className="sp-tabs" role="tablist">
          {["draw", "type"].map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === "draw" ? "Draw" : "Type"}
            </button>
          ))}
        </div>
        <div hidden={tab !== "draw"}>
          <div className="sp-pad">
            <canvas
              ref={canvasRef}
              width={1040}
              height={360}
              onPointerDown={(e) => {
                down.current = true;
                last.current = pos(e);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!down.current) return;
                const p = pos(e);
                const ctx = canvasRef.current.getContext("2d");
                ctx.strokeStyle = "#111";
                ctx.lineWidth = 5;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.beginPath();
                ctx.moveTo(last.current.x, last.current.y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
                last.current = p;
                drawn.current = true;
              }}
              onPointerUp={() => (down.current = false)}
              onPointerCancel={() => (down.current = false)}
              onPointerLeave={() => (down.current = false)}
            />
            <div className="line" />
          </div>
        </div>
        <div hidden={tab !== "type"}>
          <div className="sp-typed">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name" autoComplete="name" />
            <div className="preview">{typed}</div>
          </div>
        </div>
        <div className="sp-consent">
          By clicking Accept and sign, I agree this electronic signature is the legal equivalent of my handwritten
          signature on this proposal and its Terms of Service.
        </div>
        <div className="row">
          <button className="sp-btn" onClick={() => (tab === "draw" ? resetPad() : setTyped(""))}>
            Clear
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sp-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="sp-btn primary"
              onClick={() => {
                const img = trimmedImage();
                if (!img) return onError(tab === "draw" ? "Draw your signature in the box first." : "Type your name first.");
                onAccept(img);
              }}
            >
              Accept and sign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProposalPage({ token }) {
  const [proposal, setProposal] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState({ image: null, date: "" });
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toastText, setToastText] = useState("");
  const toastTimer = useRef(null);
  const docRef = useRef(null);
  const sigBoxRef = useRef(null);
  const dateRef = useRef(null);

  const toast = (t) => {
    setToastText(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(""), 4200);
  };

  useEffect(() => {
    if (!document.querySelector(`link[href="${FONTS_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }
    fetch(`${API_BASE}/api/proposal-public?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Couldn't load this proposal.");
        setProposal(body.proposal);
      })
      .catch((e) => setLoadError(e.message || "Couldn't load this proposal."));
  }, [token]);

  useEffect(() => {
    const first = String(proposal?.name || "").trim().split(/\s+/)[0];
    document.title = `Proposal for ${first || "client"}`;
  }, [proposal?.name]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  const signed = proposal && proposal.status !== "pending";

  const finish = async () => {
    if (!pending.image || !pending.date || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/proposal-public`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, image: pending.image, date: pending.date }),
      });
      const body = await r.json().catch(() => ({}));
      if (body.proposal) setProposal(body.proposal);
      if (!r.ok) throw new Error(body.error || "Couldn't save your signature. Please try again.");
      setPending({ image: null, date: "" });
      toast("Signed. Thank you!");
    } catch (e) {
      toast(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const download = () => {
    const clone = docRef.current.cloneNode(true);
    clone.querySelectorAll("input[type=date]").forEach((di) => {
      const s = document.createElement("span");
      s.textContent = fmtDate(signed ? proposal.signedDate : pending.date);
      di.replaceWith(s);
    });
    const title = document.title;
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
      title
    )}</title><style>body{margin:0;background:#f3f5f9}.sp-paper-wrap{padding:16px 12px 60px}${PROPOSAL_CSS}</style></head><body><div class="sp-root"><main class="sp-paper-wrap">${
      clone.outerHTML
    }</main></div></body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `Proposal - ${(proposal?.name || "Client").trim()}${signed ? " (signed)" : ""}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (loadError || !proposal) {
    return (
      <div className="sp-root">
        <style>{PAGE_CSS}</style>
        <div className="sp-center">{loadError || "Loading proposal…"}</div>
      </div>
    );
  }

  const first = String(proposal.name || "").trim().split(/\s+/)[0];
  const img = signed ? proposal.signatureImage : pending.image;
  const date = signed ? proposal.signedDate : pending.date;
  const left = (pending.image ? 0 : 1) + (pending.date ? 0 : 1);

  let banner;
  if (signed) {
    banner = (
      <div className="sp-banner done">
        <div className="flag" aria-hidden="true">
          <FlagIcon />
        </div>
        <div className="msg">
          Signed by {proposal.name || "the client"} on {fmtDate(proposal.signedDate)}
        </div>
        <button className="sp-btn primary" onClick={download}>
          Download a copy
        </button>
      </div>
    );
  } else {
    const next = () => {
      const target = !pending.image ? sigBoxRef.current : dateRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        if (!pending.image) setModalOpen(true);
        else {
          dateRef.current?.focus();
          try {
            dateRef.current?.showPicker?.();
          } catch {
            // not supported — focus is enough
          }
        }
      }, 350);
    };
    banner = (
      <div className="sp-banner">
        <div className="flag" aria-hidden="true">
          <FlagIcon />
        </div>
        <div className="msg">
          {left ? (
            <>
              This document has <b>{left} required field{left > 1 ? "s" : ""}</b>
            </>
          ) : (
            "All fields complete"
          )}
        </div>
        {left ? (
          <button className="sp-btn primary" onClick={next}>
            {left === 2 ? "Start filling out ✎" : "Next field ✎"}
          </button>
        ) : (
          <button className="sp-btn primary" onClick={finish} disabled={submitting}>
            {submitting ? "Signing…" : "Finish and sign"}
          </button>
        )}
      </div>
    );
  }

  const signBlock = (
    <div className={`sp-sign-block${signed ? " sp-locked" : ""}`}>
      <div className="sp-signer">{proposal.name}</div>
      <button
        ref={sigBoxRef}
        className={`sp-sigbox${!signed && !pending.image ? " sp-req" : ""}`}
        type="button"
        disabled={signed}
        onClick={() => setModalOpen(true)}
      >
        {img ? <img alt="Signature" src={img} /> : <span>✎ Signature</span>}
      </button>
      <div className={`sp-datebox${!signed && !pending.date ? " sp-req" : ""}`}>
        {signed ? (
          <span className="done">{fmtDate(date)}</span>
        ) : (
          <input
            ref={dateRef}
            type="date"
            aria-label="Date signed"
            value={pending.date}
            onChange={(e) => setPending((p) => ({ ...p, date: e.target.value }))}
          />
        )}
      </div>
      <div className="sp-signed-meta">
        {signed && proposal.signedAt
          ? `Signed electronically on ${new Date(proposal.signedAt).toLocaleString("en-AU", {
              dateStyle: "medium",
              timeStyle: "short",
            })}`
          : ""}
      </div>
    </div>
  );

  return (
    <div className="sp-root">
      <style>{PAGE_CSS + PROPOSAL_CSS}</style>
      <header className="sp-topbar">
        <div>
          <div className="t1">Proposal for {first}</div>
          <div className="t2">By {proposal.company}</div>
        </div>
        <button
          className="sp-kebab"
          aria-label="More options"
          aria-haspopup="true"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
        >
          ⋮
        </button>
        {menuOpen && (
          <div className="sp-menu" role="menu">
            <button role="menuitem" onClick={download}>
              Download a copy
            </button>
            <button role="menuitem" onClick={() => window.print()}>
              Print or save as PDF
            </button>
          </div>
        )}
      </header>

      <div className="sp-banner-wrap">{banner}</div>

      <main className="sp-paper-wrap">
        <ProposalDocument
          docRef={docRef}
          name={proposal.name}
          amount={proposal.amount}
          period={proposal.period}
          signBlock={signBlock}
        />
      </main>

      {modalOpen && (
        <SignatureModal
          defaultName={proposal.name}
          onCancel={() => {
            setModalOpen(false);
            sigBoxRef.current?.focus();
          }}
          onError={toast}
          onAccept={(image) => {
            setPending((p) => ({ image, date: p.date || todayStr() }));
            setModalOpen(false);
          }}
        />
      )}

      {toastText && (
        <div className="sp-toast" role="status">
          {toastText}
        </div>
      )}
    </div>
  );
}

function FlagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1d5fe0" strokeWidth="2">
      <path d="M5 21V4h11l-2 4 2 4H5" />
    </svg>
  );
}
