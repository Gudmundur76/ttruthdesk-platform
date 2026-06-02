import { TopNav } from "@/components/TopNav";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// ─── Static vertical metadata ────────────────────────────────────────────────

const VERTICAL_META: Record<
  string,
  {
    label: string;
    tagline: string;
    description: string;
    evidenceSources: string[];
    color: string;
    accentBg: string;
    accentText: string;
    icon: React.ReactNode;
    status: "live" | "beta" | "coming_soon";
  }
> = {
  structural_biology: {
    label: "Structural Biology",
    tagline: "PDB · RCSB · Crystallography · Cryo-EM",
    description:
      "Validates molecular claims in biotech documents against the RCSB Protein Data Bank — the world's primary repository of 3D protein, nucleic acid, and complex structures. Covers resolution values, experimental methods, organism annotations, ligand binding, and structure release dates.",
    evidenceSources: ["RCSB Protein Data Bank", "PDB Europe", "UniProt", "PubMed"],
    color: "#3b82f6",
    accentBg: "bg-blue-50",
    accentText: "text-blue-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    status: "live",
  },
  salmon_biotech: {
    label: "Salmon Biotech",
    tagline: "Aquaculture · Marine Biology · PubChem · Feed Science",
    description:
      "Validates claims in salmon farming, aquaculture, and marine biotech documents against PubChem compound databases, peer-reviewed aquaculture literature, and feed ingredient evidence. Covers omega-3 profiles, feed conversion ratios, disease resistance markers, and environmental impact metrics.",
    evidenceSources: ["PubChem", "PubMed Aquaculture", "FAO Fisheries", "NOFIMA Research"],
    color: "#10b981",
    accentBg: "bg-emerald-50",
    accentText: "text-emerald-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6.5 12c0-4.5 3.5-8 8-8 1.5 0 3 .5 4 1.5" />
        <path d="M6.5 12c0 4.5 3.5 8 8 8 1.5 0 3-.5 4-1.5" />
        <path d="M6.5 12H2" />
        <path d="M18.5 8l3-3" />
        <path d="M18.5 16l3 3" />
        <circle cx="9" cy="12" r="1.5" fill="currentColor" />
      </svg>
    ),
    status: "beta",
  },
};

// ─── Upcoming verticals ───────────────────────────────────────────────────────

const UPCOMING = [
  {
    label: "Clinical Genomics",
    tagline: "GWAS · ClinVar · gnomAD · Variant interpretation",
    color: "#8b5cf6",
    accentBg: "bg-violet-50",
    accentText: "text-violet-700",
  },
  {
    label: "Drug Discovery",
    tagline: "ChEMBL · DrugBank · Clinical trials · IC50 claims",
    color: "#f59e0b",
    accentBg: "bg-amber-50",
    accentText: "text-amber-700",
  },
  {
    label: "Agri-Biotech",
    tagline: "USDA · Crop genomics · Trait claims · Yield data",
    color: "#84cc16",
    accentBg: "bg-lime-50",
    accentText: "text-lime-700",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "live" | "beta" | "coming_soon" }) {
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-2.5 py-0.5 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Live
      </span>
    );
  }
  if (status === "beta") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        Beta
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-500 px-2.5 py-0.5 text-xs font-semibold">
      Coming soon
    </span>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.45 } }),
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Verticals() {
  const { data: stats, isLoading, isError } = trpc.verticals.stats.useQuery();

  const statsByDomain = Object.fromEntries((stats ?? []).map((s) => [s.domain, s]));

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-grid opacity-60 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background pointer-events-none" />
        <div className="container relative py-20 md:py-28">
          <motion.div initial="hidden" animate="visible" className="max-w-3xl">
            <motion.div custom={0} variants={fadeUp} className="mb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                Platform Architecture
              </span>
            </motion.div>
            <motion.h1
              custom={1}
              variants={fadeUp}
              className="text-4xl md:text-5xl font-bold text-slate-900 leading-tight mb-5"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              One platform.
              <br />
              <span className="text-blue-800">Many scientific domains.</span>
            </motion.h1>
            <motion.p custom={2} variants={fadeUp} className="text-lg text-slate-600 leading-relaxed max-w-2xl">
              Truth Desk is built as a domain-agnostic evidence engine. Each vertical connects the same audit pipeline to a different set of authoritative databases, claim types, and evidence sources. New verticals can be added without rebuilding the core.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Live verticals */}
      <section className="container py-16">
        <h2 className="text-2xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Active verticals
        </h2>
        <p className="text-slate-500 text-sm mb-8">Verticals currently processing documents and producing audit reports.</p>

        {isError && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Live statistics are temporarily unavailable. Document and claim counts will appear once the connection is restored.
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-6">
          {Object.entries(VERTICAL_META).map(([key, meta], i) => {
            const s = statsByDomain[key];
            return (
              <motion.div
                key={key}
                custom={i}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="rounded-2xl border border-border bg-white shadow-sm hover:shadow-md transition-shadow p-6 flex flex-col gap-5"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: meta.color + "18", color: meta.color }}
                    >
                      {meta.icon}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-lg leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                        {meta.label}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">{meta.tagline}</p>
                    </div>
                  </div>
                  <StatusBadge status={meta.status} />
                </div>

                {/* Description */}
                <p className="text-sm text-slate-600 leading-relaxed">{meta.description}</p>

                {/* Evidence sources */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Evidence sources</p>
                  <div className="flex flex-wrap gap-1.5">
                    {meta.evidenceSources.map((src) => (
                      <span key={src} className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", meta.accentBg, meta.accentText)}>
                        {src}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Stats */}
                {isLoading ? (
                  <div className="flex gap-6">
                    {[1, 2, 3].map((n) => (
                      <div key={n} className="h-10 w-20 bg-slate-100 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : s ? (
                  <div className="grid grid-cols-3 gap-3 pt-1 border-t border-border">
                    <div>
                      <p className="text-2xl font-bold text-slate-900">{s.totalDocs}</p>
                      <p className="text-xs text-slate-400">Documents</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-slate-900">{s.totalClaims.toLocaleString()}</p>
                      <p className="text-xs text-slate-400">Claims</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold" style={{ color: meta.color }}>
                        {s.totalClaims > 0 ? Math.round((s.supportedClaims / s.totalClaims) * 100) : 0}%
                      </p>
                      <p className="text-xs text-slate-400">Support rate</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 pt-1 border-t border-border">
                    {["0", "0", "—"].map((v, idx) => (
                      <div key={idx}>
                        <p className="text-2xl font-bold text-slate-300">{v}</p>
                        <p className="text-xs text-slate-400">{["Documents", "Claims", "Support rate"][idx]}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* CTA */}
                <div className="flex gap-2 mt-auto">
                  <Link
                    href="/submit"
                    className="flex-1 text-center text-sm font-medium py-2 rounded-lg border border-border text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Submit document
                  </Link>
                  <Link
                    href="/registry"
                    className="flex-1 text-center text-sm font-medium py-2 rounded-lg text-white transition-colors"
                    style={{ backgroundColor: meta.color }}
                  >
                    View registry
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Upcoming verticals */}
      <section className="border-t border-border bg-slate-50">
        <div className="container py-16">
          <h2 className="text-2xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            On the roadmap
          </h2>
          <p className="text-slate-500 text-sm mb-8">Verticals in research or early development. Interested in one? Request it below.</p>

          <div className="grid sm:grid-cols-3 gap-4 mb-12">
            {UPCOMING.map((v, i) => (
              <motion.div
                key={v.label}
                custom={i}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                className="rounded-xl border border-border bg-white p-5 flex flex-col gap-3"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: v.color + "18" }}
                >
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{v.label}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{v.tagline}</p>
                </div>
                <span className={cn("self-start rounded-full px-2.5 py-0.5 text-xs font-medium", v.accentBg, v.accentText)}>
                  Planned
                </span>
              </motion.div>
            ))}
          </div>

          {/* Request a new vertical CTA */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h3 className="text-xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Need a vertical that isn't listed?
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed max-w-xl">
                The Truth Desk engine can be adapted to any scientific domain with authoritative databases. If you work in a field where verifiable claims matter — materials science, environmental monitoring, food safety, or anything else — reach out and we'll scope a vertical together.
              </p>
            </div>
            <div className="flex-shrink-0">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors"
              >
                Request a vertical →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
