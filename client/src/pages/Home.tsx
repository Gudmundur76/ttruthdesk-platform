/**
 * Home.tsx — Truth Desk landing page
 *
 * Design adapted from the Xero hero prompt:
 * - Dark hero card (#0d0b12) with pink-magenta radial gradient arc
 * - Animated beam pipeline: Ingest → Verify → Report
 * - Neumorphic icon nodes with side-light glows
 * - requestAnimationFrame state machine (p1 → splash → p2 → idle, ~3.4s cycle)
 * - Brand / evidence source row
 * - Features, pricing, footer sections below
 */

import { useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { TopNav } from "@/components/TopNav";
import { VerdictBadge } from "@/components/VerdictBadge";
import { motion } from "framer-motion";

// ─── Feature cards ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    title: "Document Ingestion",
    desc: "Upload pitch decks, abstracts, whitepapers, and patents. Paste text directly or upload PDF and text files.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    title: "Claim Extraction",
    desc: "LLM-powered extraction of PDB IDs, protein names, methods, resolution values, organisms, and ligands.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "PDB Evidence Validation",
    desc: "Every claim checked against the RCSB Protein Data Bank — the world's primary 3D molecular structure repository.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: "Scoped Verdict Engine",
    desc: "Seven precise verdict labels: Supported, Contradicted, Partially Supported, Ambiguous, Insufficient Evidence, Out of Scope, Needs Expert Review.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    ),
    title: "Knowledge Graph",
    desc: "Force-directed graph of all verified claims, PDB structures, and cross-vertical relationships — filterable and embeddable.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    title: "Continuous Monitoring",
    desc: "Autonomous nightly monitoring of PubMed and PMC Open Access for new evidence relevant to your audited documents.",
  },
];

const PRICING = [
  {
    name: "Starter",
    price: "$1,500",
    desc: "Single document audit for early-stage diligence.",
    features: ["Up to 50 molecular claims", "Full PDB evidence validation", "HTML + PDF audit report", "48-hour turnaround"],
    cta: "Request Starter Audit",
    tier: "starter" as const,
    highlight: false,
  },
  {
    name: "Diligence",
    price: "$5,000",
    desc: "Comprehensive audit for investment-grade diligence.",
    features: ["Up to 200 molecular claims", "Multi-document analysis", "Human expert review layer", "30-day monitoring", "24-hour turnaround"],
    cta: "Request Diligence Audit",
    tier: "diligence" as const,
    highlight: true,
  },
  {
    name: "Platform Pilot",
    price: "Custom",
    desc: "API access and white-label integration for teams.",
    features: ["Unlimited documents", "API access", "Custom evidence sources", "Dedicated support", "SLA guarantee"],
    cta: "Contact Us",
    tier: "platform_pilot" as const,
    highlight: false,
  },
];

// ─── Beam animation state machine ────────────────────────────────────────────

type BeamState = "p1" | "splash" | "p2" | "idle";

const PHASE_DURATION = { p1: 800, splash: 800, p2: 800, idle: 1000 };

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const { isAuthenticated } = useAuth();

  // Pipeline refs
  const pipelineRef = useRef<HTMLDivElement>(null);
  const nodeIngestRef = useRef<HTMLDivElement>(null);
  const nodeCenterRef = useRef<HTMLDivElement>(null);
  const nodeReportRef = useRef<HTMLDivElement>(null);
  const beamPath1Ref = useRef<SVGPathElement>(null);
  const beamPath2Ref = useRef<SVGPathElement>(null);
  const gradientRef = useRef<SVGLinearGradientElement>(null);
  const splashRef = useRef<HTMLDivElement>(null);

  const rafRef = useRef<number>(0);
  const stateRef = useRef<BeamState>("p1");
  const lastChangeRef = useRef<number>(0);

  const updatePath = useCallback(() => {
    const pipeline = pipelineRef.current;
    const nodeIngest = nodeIngestRef.current;
    const nodeCenter = nodeCenterRef.current;
    const nodeReport = nodeReportRef.current;
    const path1 = beamPath1Ref.current;
    const path2 = beamPath2Ref.current;
    if (!pipeline || !nodeIngest || !nodeCenter || !nodeReport || !path1 || !path2) return;

    const pRect = pipeline.getBoundingClientRect();
    const sRect = nodeIngest.getBoundingClientRect();
    const xRect = nodeCenter.getBoundingClientRect();
    const shRect = nodeReport.getBoundingClientRect();

    const startX = sRect.left + sRect.width / 2 - pRect.left;
    const startY = sRect.top + sRect.height / 2 - pRect.top;
    const midX = xRect.left + xRect.width / 2 - pRect.left;
    const midY = xRect.top + xRect.height / 2 - pRect.top;
    const endX = shRect.left + shRect.width / 2 - pRect.left;
    const endY = shRect.top + shRect.height / 2 - pRect.top;

    const d = `M ${startX},${startY} L ${midX},${midY} L ${endX},${endY}`;
    path1.setAttribute("d", d);
    path2.setAttribute("d", d);
  }, []);

  useEffect(() => {
    updatePath();
    const onResize = () => updatePath();
    window.addEventListener("resize", onResize);

    let lastTs = 0;

    function tick(ts: number) {
      if (!lastTs) { lastTs = ts; lastChangeRef.current = ts; }
      const elapsed = ts - lastChangeRef.current;
      const state = stateRef.current;
      const gradient = gradientRef.current;
      const splash = splashRef.current;
      const nodeIngest = nodeIngestRef.current;
      const nodeReport = nodeReportRef.current;
      const path1 = beamPath1Ref.current;
      const path2 = beamPath2Ref.current;

      const duration = PHASE_DURATION[state];
      const progress = Math.min(elapsed / duration, 1);

      if (state === "p1") {
        const pct = easeInOut(progress) * 0.5; // 0 → 0.5
        const center = pct * 100;
        if (gradient) {
          gradient.setAttribute("x1", `${center - 5}%`);
          gradient.setAttribute("x2", `${center + 5}%`);
          gradient.setAttribute("y1", "0%");
          gradient.setAttribute("y2", "0%");
        }
        if (pct < 0.2 && nodeIngest) nodeIngest.classList.add("td-node-active");
        else if (nodeIngest) nodeIngest.classList.remove("td-node-active");

        if (progress >= 1) {
          stateRef.current = "splash";
          lastChangeRef.current = ts;
          if (path1) path1.style.opacity = "0";
          if (path2) path2.style.opacity = "0";
          if (splash) { splash.classList.add("td-splash-animate"); }
        }
      } else if (state === "splash") {
        if (progress >= 1) {
          stateRef.current = "p2";
          lastChangeRef.current = ts;
          if (path1) path1.style.opacity = "1";
          if (path2) path2.style.opacity = "1";
          if (splash) splash.classList.remove("td-splash-animate");
        }
      } else if (state === "p2") {
        const pct = 0.5 + easeInOut(progress) * 0.5; // 0.5 → 1.0
        const center = pct * 100;
        if (gradient) {
          gradient.setAttribute("x1", `${center - 5}%`);
          gradient.setAttribute("x2", `${center + 5}%`);
        }
        if (pct > 0.8 && nodeReport) nodeReport.classList.add("td-node-active");
        else if (nodeReport) nodeReport.classList.remove("td-node-active");

        if (progress >= 1) {
          if (nodeReport) nodeReport.classList.remove("td-node-active");
          stateRef.current = "idle";
          lastChangeRef.current = ts;
        }
      } else if (state === "idle") {
        if (progress >= 1) {
          stateRef.current = "p1";
          lastChangeRef.current = ts;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updatePath]);

  return (
    <div className="td-root">
      <TopNav />
      <main id="main-content" aria-label="Truth Desk platform">

      {/* ── NAV already rendered by TopNav ── */}

      {/* ── HERO CARD ─────────────────────────────────────────────────────── */}
      <div className="td-page-wrap">
        <section className="td-hero-card" aria-labelledby="hero-heading">
          {/* Gradient arc ::before is CSS-only */}
          <div className="td-hero-grid" />

          {/* Icon pipeline */}
          <div className="td-icon-pipeline" ref={pipelineRef}>
            {/* Beam SVG */}
            <svg
              className="td-beam-svg"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", zIndex: 2 }}
            >
              <defs>
                <filter id="td-glow">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <linearGradient ref={gradientRef} id="td-beam-gradient" gradientUnits="userSpaceOnUse" x1="0%" x2="10%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="#b04090" stopOpacity="0" />
                  <stop offset="20%" stopColor="#b04090" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
                  <stop offset="80%" stopColor="#c8a0e0" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#c8a0e0" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Glow path */}
              <path
                ref={beamPath1Ref}
                stroke="url(#td-beam-gradient)"
                strokeWidth="2"
                fill="none"
                filter="url(#td-glow)"
                opacity="0.6"
              />
              {/* Core path */}
              <path
                ref={beamPath2Ref}
                stroke="url(#td-beam-gradient)"
                strokeWidth="0.8"
                fill="none"
              />

            </svg>

            {/* Left node — Ingest (layers icon) */}
            <div className="td-icon-node td-node-light-right" id="td-node-ingest" ref={nodeIngestRef}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </div>

            <div className="td-pipeline-line" />

            {/* Center node — Verify (Truth Desk logo mark) */}
            <div style={{ position: "relative" }}>
              <div className="td-splash" ref={splashRef} />
              <div className="td-icon-node-center" id="td-node-center" ref={nodeCenterRef}>
                {/* Truth Desk "T" mark */}
                <svg width="28" height="28" viewBox="0 0 40 40" fill="white">
                  <path d="M6 8h28v5H24v19h-8V13H6z" />
                </svg>
              </div>
            </div>

            <div className="td-pipeline-line td-pipeline-line-right" />

            {/* Right node — Report (shield-check icon) */}
            <div className="td-icon-node td-node-light-left" id="td-node-report" ref={nodeReportRef}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
            </div>
          </div>

          {/* Hero text */}
          <div className="td-hero-content">
            <div className="td-badge">
              <span className="td-badge-dot" />
              Multi-Vertical Evidence Intelligence
            </div>
            <h1 className="td-hero-heading" id="hero-heading">
              Verify scientific claims
              <strong>against authoritative databases.</strong>
            </h1>
            <p className="td-hero-sub">
              Truth Desk is an autonomous evidence auditing platform. Upload any scientific document — pitch deck, abstract, whitepaper, or patent — and receive a structured, traceable audit report with every claim verified against PDB, PubChem, and domain-specific sources.
            </p>
            <div className="td-hero-actions">
              {isAuthenticated ? (
                <Link href="/dashboard" className="td-btn-cta">Open Dashboard →</Link>
              ) : (
                <a href={getLoginUrl()} className="td-btn-cta">Start Free Audit →</a>
              )}
              <Link href="/pricing" className="td-btn-outline">Request Diligence Audit</Link>
            </div>
          </div>

          {/* Verdict preview card */}
          <div className="td-verdict-preview">
            <div className="td-verdict-header">
              <span className="td-verdict-dot" />
              <span className="td-verdict-label">Live verdict preview</span>
            </div>
            {[
              { claim: "The crystal structure of lysozyme was solved at 1.8 Å resolution (PDB: 1LYZ)", verdict: "Supported" },
              { claim: "Our proprietary antibody binds EGFR with sub-nanomolar affinity confirmed by X-ray crystallography", verdict: "Needs Expert Review" },
              { claim: "The protein adopts an alpha-helical fold not observed in any known PDB structure", verdict: "Insufficient Evidence" },
            ].map((row, i) => (
              <div key={i} className="td-verdict-row">
                <VerdictBadge verdict={row.verdict} size="sm" className="shrink-0" />
                <p className="td-verdict-claim">{row.claim}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── EVIDENCE SOURCES ROW ──────────────────────────────────────────── */}
        <div className="td-brands">
          {/* PDB */}
          <div className="td-brand-item">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path fill="#0a0a0f" d="M7 8h4c2 0 3 1 3 2.5S13 13 11 13H9v3H7zm2 4h2c.8 0 1-.4 1-1s-.2-1-1-1H9z" />
            </svg>
            <span>RCSB PDB</span>
          </div>
          {/* PubChem */}
          <div className="td-brand-item">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3" fill="currentColor" />
              <circle cx="5" cy="7" r="2.5" />
              <circle cx="19" cy="7" r="2.5" />
              <circle cx="5" cy="17" r="2.5" />
              <circle cx="19" cy="17" r="2.5" />
              <line x1="7" y1="8" x2="10" y2="11" />
              <line x1="17" y1="8" x2="14" y2="11" />
              <line x1="7" y1="16" x2="10" y2="13" />
              <line x1="17" y1="16" x2="14" y2="13" />
            </svg>
            <span>PubChem</span>
          </div>
          {/* PubMed */}
          <div className="td-brand-item">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 19V5a2 2 0 0 1 2-2h13" />
              <path d="M8 21h12a1 1 0 0 0 1-1V7" />
              <line x1="8" y1="9" x2="15" y2="9" />
              <line x1="8" y1="13" x2="13" y2="13" />
            </svg>
            <span>PubMed</span>
          </div>
          {/* UniProt */}
          <div className="td-brand-item">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 3C7 3 4 7 4 12s3 9 8 9 8-4 8-9" />
              <path d="M16 3l4 4-4 4" />
            </svg>
            <span>UniProt</span>
          </div>
          {/* PMC OA */}
          <div className="td-brand-item">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="3" x2="12" y2="21" />
              <path d="M3 12h18" />
              <path d="M12 3a9 9 0 0 1 6 9 9 9 0 0 1-6 9" />
            </svg>
            <span>PMC Open Access</span>
          </div>
        </div>
      </div>

      {/* ── FEATURES ──────────────────────────────────────────────────────── */}
      <section className="td-section td-section-alt" aria-labelledby="features-heading">
        <div className="td-container">
          <div className="td-section-header">
            <h2 className="td-section-title" id="features-heading">Built for rigorous scientific diligence</h2>
            <p className="td-section-sub">Every component is designed for precision, traceability, and trust — not speed at the expense of accuracy.</p>
          </div>
          <div className="td-features-grid">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                className="td-feature-card"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
              >
                <div className="td-feature-icon">{f.icon}</div>
                <h3 className="td-feature-title">{f.title}</h3>
                <p className="td-feature-desc">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ───────────────────────────────────────────────────────── */}
      <section className="td-section" id="pricing" aria-labelledby="pricing-heading">
        <div className="td-container">
          <div className="td-section-header">
            <h2 className="td-section-title" id="pricing-heading">Transparent pricing</h2>
            <p className="td-section-sub">Concierge audit reports for investors, pharma BD teams, AI-bio founders, and publishers.</p>
          </div>
          <div className="td-pricing-grid">
            {PRICING.map((plan) => (
              <div key={plan.name} className={`td-pricing-card${plan.highlight ? " td-pricing-highlight" : ""}`}>
                <div>
                  <p className="td-pricing-tier">{plan.name}</p>
                  <p className="td-pricing-price">{plan.price}</p>
                  <p className="td-pricing-desc">{plan.desc}</p>
                </div>
                <ul className="td-pricing-features">
                  {plan.features.map((feat) => (
                    <li key={feat} className="td-pricing-feature">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={plan.highlight ? "#86efac" : "#16a34a"} strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
                <Link href={`/pricing?tier=${plan.tier}`} className={`td-pricing-btn${plan.highlight ? " td-pricing-btn-highlight" : ""}`}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      </main>
      <footer className="td-footer" role="contentinfo" aria-label="Site footer">
        <div className="td-container td-footer-inner">
          <div className="td-footer-brand">
            <div className="td-footer-logo">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
              </svg>
            </div>
            <span className="td-footer-name">Truth Desk</span>
          </div>
          <p className="td-footer-note">
            Evidence verification powered by RCSB PDB · Not a substitute for expert scientific judgment
          </p>
        </div>
      </footer>
    </div>
  );
}
