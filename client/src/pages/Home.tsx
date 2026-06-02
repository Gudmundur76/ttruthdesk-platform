import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { VerdictBadge } from "@/components/VerdictBadge";
import { TopNav } from "@/components/TopNav";
import { motion } from "framer-motion";

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    title: "Document Ingestion",
    desc: "Upload pitch decks, abstracts, whitepapers, and patent summaries. Paste text directly or upload PDF and text files.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    title: "Molecular Claim Extraction",
    desc: "LLM-powered extraction of PDB IDs, protein names, experimental methods, resolution values, organisms, and ligands.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "PDB Evidence Validation",
    desc: "Every claim is checked against the RCSB Protein Data Bank — the world's primary repository of 3D molecular structures.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: "Scoped Verdict Engine",
    desc: "Seven precise verdict labels: Supported, Contradicted, Partially Supported, Ambiguous, Insufficient Evidence, Out of Scope, Needs Expert Review.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
    title: "Exportable Audit Reports",
    desc: "Full evidence audit reports with claim tables, rationale, PDB source links, and verdict distributions — exported as HTML or PDF.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    title: "Continuous Monitoring",
    desc: "Autonomous daily monitoring of PubMed, bioRxiv, and patent feeds for new evidence relevant to your audited documents.",
  },
];

const VERDICTS = [
  "Supported",
  "Contradicted",
  "Partially Supported",
  "Ambiguous",
  "Insufficient Evidence",
  "Needs Expert Review",
];

const PRICING = [
  {
    name: "Starter",
    price: "$1,500",
    desc: "Single document audit for early-stage diligence.",
    features: [
      "Up to 50 molecular claims",
      "Full PDB evidence validation",
      "HTML + PDF audit report",
      "48-hour turnaround",
    ],
    cta: "Request Starter Audit",
    tier: "starter" as const,
    highlight: false,
  },
  {
    name: "Diligence",
    price: "$5,000",
    desc: "Comprehensive audit for investment-grade diligence.",
    features: [
      "Up to 200 molecular claims",
      "Multi-document analysis",
      "Human expert review layer",
      "Monitoring for 30 days",
      "24-hour turnaround",
    ],
    cta: "Request Diligence Audit",
    tier: "diligence" as const,
    highlight: true,
  },
  {
    name: "Platform Pilot",
    price: "Custom",
    desc: "API access and white-label integration for teams.",
    features: [
      "Unlimited documents",
      "API access",
      "Custom evidence sources",
      "Dedicated support",
      "SLA guarantee",
    ],
    cta: "Contact Us",
    tier: "platform_pilot" as const,
    highlight: false,
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.45 },
  }),
};

export default function Home() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-grid opacity-60 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background pointer-events-none" />
        <div className="container relative py-24 md:py-32">
          <motion.div
            initial="hidden"
            animate="visible"
            className="max-w-3xl"
          >
            <motion.div custom={0} variants={fadeUp} className="mb-5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                Molecular Evidence Intelligence
              </span>
            </motion.div>
            <motion.h1
              custom={1}
              variants={fadeUp}
              className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 leading-tight mb-6"
            >
              Verify biotech claims
              <br />
              <span className="text-blue-800">against the Protein Data Bank.</span>
            </motion.h1>
            <motion.p
              custom={2}
              variants={fadeUp}
              className="text-lg text-slate-600 leading-relaxed mb-8 max-w-2xl"
            >
              Protein Truth Desk is an autonomous molecular evidence auditing platform. Upload any biotech document — pitch deck, abstract, whitepaper, or patent — and receive a structured, traceable audit report with every molecular claim verified against authoritative structural biology databases.
            </motion.p>
            <motion.div custom={3} variants={fadeUp} className="flex flex-wrap gap-3">
              {isAuthenticated ? (
                <Button size="lg" asChild className="bg-slate-900 hover:bg-slate-800">
                  <Link href="/dashboard">Open Dashboard →</Link>
                </Button>
              ) : (
                <Button size="lg" asChild className="bg-slate-900 hover:bg-slate-800">
                  <a href={getLoginUrl()}>Start Free Audit →</a>
                </Button>
              )}
              <Button size="lg" variant="outline" asChild>
                <Link href="/pricing">Request Diligence Audit</Link>
              </Button>
            </motion.div>
          </motion.div>

          {/* Verdict preview */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mt-16 max-w-2xl"
          >
            <div className="glass rounded-xl p-5 shadow-lg shadow-slate-200">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-xs font-medium text-slate-500">Live verdict preview</span>
              </div>
              <div className="space-y-2.5">
                {[
                  {
                    claim: 'The crystal structure of lysozyme was solved at 1.8 Å resolution (PDB: 1LYZ)',
                    verdict: "Supported",
                  },
                  {
                    claim: "Our proprietary antibody binds EGFR with sub-nanomolar affinity confirmed by X-ray crystallography",
                    verdict: "Needs Expert Review",
                  },
                  {
                    claim: "The protein adopts an alpha-helical fold not observed in any known PDB structure",
                    verdict: "Insufficient Evidence",
                  },
                ].map((row, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
                    <VerdictBadge verdict={row.verdict} size="sm" className="mt-0.5 shrink-0" />
                    <p className="text-xs text-slate-600 leading-relaxed">{row.claim}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Verdict labels */}
      <section className="border-b border-border py-10 bg-slate-50">
        <div className="container">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
            Seven scoped verdict labels
          </p>
          <div className="flex flex-wrap gap-2">
            {VERDICTS.map((v) => (
              <VerdictBadge key={v} verdict={v} />
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 border-b border-border">
        <div className="container">
          <div className="max-w-xl mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">
              Built for rigorous scientific diligence
            </h2>
            <p className="text-slate-600">
              Every component of the platform is designed for precision, traceability, and trust — not speed or convenience at the expense of accuracy.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                className="rounded-xl border border-border bg-white p-5 hover:shadow-md hover:shadow-slate-100 transition-shadow"
              >
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 mb-4">
                  {f.icon}
                </div>
                <h3 className="font-semibold text-slate-900 mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 border-b border-border" id="pricing">
        <div className="container">
          <div className="max-w-xl mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-3">Transparent pricing</h2>
            <p className="text-slate-600">
              Concierge audit reports for investors, pharma BD teams, AI-bio founders, and publishers.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl">
            {PRICING.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-6 flex flex-col ${
                  plan.highlight
                    ? "border-blue-800 bg-slate-900 text-white shadow-xl shadow-slate-200"
                    : "border-border bg-white"
                }`}
              >
                <div className="mb-5">
                  <p
                    className={`text-xs font-semibold uppercase tracking-widest mb-1 ${
                      plan.highlight ? "text-blue-300" : "text-slate-400"
                    }`}
                  >
                    {plan.name}
                  </p>
                  <p
                    className={`text-3xl font-bold mb-1 ${
                      plan.highlight ? "text-white" : "text-slate-900"
                    }`}
                  >
                    {plan.price}
                  </p>
                  <p
                    className={`text-sm ${plan.highlight ? "text-slate-300" : "text-slate-500"}`}
                  >
                    {plan.desc}
                  </p>
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={plan.highlight ? "#86efac" : "#16a34a"}
                        strokeWidth="2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span className={plan.highlight ? "text-slate-200" : "text-slate-600"}>
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={plan.highlight ? "default" : "outline"}
                  className={
                    plan.highlight
                      ? "bg-white text-slate-900 hover:bg-slate-100"
                      : ""
                  }
                >
                  <Link href={`/pricing?tier=${plan.tier}`}>{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 bg-slate-50">
        <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-slate-900 to-blue-800 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-700">Protein Truth Desk</span>
          </div>
          <p className="text-xs text-slate-400">
            Molecular evidence verification powered by RCSB PDB · Not a substitute for expert scientific judgment
          </p>
        </div>
      </footer>
    </div>
  );
}
