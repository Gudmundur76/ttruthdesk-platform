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
    status: "live" | "beta";
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
    status: "live",
  },
  protein_supplement: {
    label: "Protein Supplements",
    tagline: "Whey · Casein · Pea · Soy · PubChem · PubMed",
    description:
      "Verifies claims about protein supplements (whey, casein, soy, pea, collagen, etc.) against PubChem compound data and peer-reviewed sports nutrition literature. Covers amino acid profiles, bioavailability, leucine content, and efficacy claims.",
    evidenceSources: ["PubChem", "PubMed Sports Nutrition", "USDA FoodData Central", "Examine.com Research"],
    color: "#f59e0b",
    accentBg: "bg-amber-50",
    accentText: "text-amber-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    ),
    status: "live",
  },
  creatine_ergogenics: {
    label: "Creatine & Ergogenics",
    tagline: "Creatine · Beta-Alanine · HMB · Caffeine · RCT Evidence",
    description:
      "Verifies performance and safety claims about creatine monohydrate, beta-alanine, HMB, caffeine, citrulline, and other ergogenic aids against PubChem compound data and systematic reviews of RCT evidence.",
    evidenceSources: ["PubChem", "PubMed RCTs", "Cochrane Reviews", "ISSN Position Stands"],
    color: "#ef4444",
    accentBg: "bg-red-50",
    accentText: "text-red-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    status: "live",
  },
  gut_microbiome: {
    label: "Gut Microbiome & Protein",
    tagline: "Microbiome · Prebiotics · Probiotics · Fermentation",
    description:
      "Verifies claims about the interaction between dietary protein and the gut microbiome, including probiotic and prebiotic effects, fermentation markers, and microbial diversity outcomes against peer-reviewed microbiome research.",
    evidenceSources: ["PubMed Microbiome", "Human Microbiome Project", "NCBI Taxonomy", "Gut Microbiota for Health"],
    color: "#8b5cf6",
    accentBg: "bg-violet-50",
    accentText: "text-violet-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="M7 10c1.5-1 3.5-1 5 0s3.5 1 5 0" />
        <path d="M7 14c1.5 1 3.5 1 5 0s3.5-1 5 0" />
      </svg>
    ),
    status: "live",
  },
  collagen_peptides: {
    label: "Collagen & Peptides",
    tagline: "Hydrolysed Collagen · Skin Elasticity · Joint Health",
    description:
      "Verifies claims about hydrolysed collagen, collagen peptides, and gelatin supplements and their effects on skin elasticity, joint health, and bone density against PubChem compound data and clinical trial evidence.",
    evidenceSources: ["PubChem", "PubMed Dermatology", "ClinicalTrials.gov", "EFSA Scientific Opinions"],
    color: "#ec4899",
    accentBg: "bg-pink-50",
    accentText: "text-pink-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="M8 12h8" />
        <path d="M12 8v8" />
      </svg>
    ),
    status: "live",
  },
  plant_based_protein: {
    label: "Plant-Based Protein",
    tagline: "Soy · Pea · Rice · Hemp · Mycoprotein · DIAAS Scores",
    description:
      "Verifies claims about plant protein sources (soy, pea, rice, hemp, lentil, quinoa, mycoprotein) including nutritional completeness, amino acid profiles, digestibility (DIAAS scores), and environmental impact claims.",
    evidenceSources: ["PubChem", "USDA FoodData Central", "FAO/WHO DIAAS Reports", "PubMed Nutrition"],
    color: "#84cc16",
    accentBg: "bg-lime-50",
    accentText: "text-lime-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 22V12" />
        <path d="M12 12C12 7 8 3 3 3c0 5 4 9 9 9" />
        <path d="M12 12c0-5 4-9 9-9-1 5-5 9-9 9" />
      </svg>
    ),
    status: "live",
  },
  sports_nutrition_rct: {
    label: "Sports Nutrition RCTs",
    tagline: "RCTs · Systematic Reviews · Meta-analyses · GRADE",
    description:
      "Meta-vertical that verifies sports nutrition claims specifically against high-quality RCT and systematic review evidence. Applies strict evidence grading (GRADE methodology) to distinguish well-supported claims from those lacking robust trial data.",
    evidenceSources: ["PubMed RCTs", "Cochrane Library", "ISSN Position Stands", "EFSA NDA Panel"],
    color: "#0ea5e9",
    accentBg: "bg-sky-50",
    accentText: "text-sky-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    status: "live",
  },
  uniprot: {
    label: "UniProt (Protein Identity)",
    tagline: "UniProt · SwissProt · Gene Names · Functional Annotations",
    description:
      "Verifies protein identity claims (protein names, gene names, organism associations, functional annotations) against the UniProt/Swiss-Prot knowledgebase — the world's most comprehensive manually annotated protein database.",
    evidenceSources: ["UniProt/Swiss-Prot", "UniProt/TrEMBL", "Ensembl", "NCBI Gene"],
    color: "#6366f1",
    accentBg: "bg-indigo-50",
    accentText: "text-indigo-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
    status: "live",
  },
  clinical_trials: {
    label: "ClinicalTrials.gov",
    tagline: "Trial Registry · Phases · Status · Interventions",
    description:
      "Verifies clinical trial claims (trial registration, status, interventions, phases, enrollment) against the ClinicalTrials.gov registry — the world's largest database of publicly and privately supported clinical studies.",
    evidenceSources: ["ClinicalTrials.gov", "EU Clinical Trials Register", "WHO ICTRP", "PubMed Clinical"],
    color: "#14b8a6",
    accentBg: "bg-teal-50",
    accentText: "text-teal-700",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
      </svg>
    ),
    status: "live",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "live" | "beta" }) {
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-2.5 py-0.5 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
      Beta
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
                    href={`/verticals/${key}`}
                    className="flex-1 text-center text-sm font-medium py-2 rounded-lg text-white transition-colors"
                    style={{ backgroundColor: meta.color }}
                  >
                    View details
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Custom vertical CTA */}
      <section className="border-t border-border bg-slate-50">
        <div className="container py-16">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h3 className="text-xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Need a domain that isn’t listed?
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed max-w-xl">
                The Truth Desk engine can be adapted to any scientific domain with authoritative databases. If you work in a field where verifiable claims matter — materials science, environmental monitoring, food safety, or clinical genomics — reach out and we’ll scope a vertical together.
              </p>
            </div>
            <div className="flex-shrink-0">
              <Link
                href="/submit"
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors"
              >
                Submit a document →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
