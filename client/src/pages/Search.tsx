import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Verdict colours ──────────────────────────────────────────────────────────

const VERDICT_COLOR: Record<string, string> = {
  "Supported": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "Contradicted": "bg-red-500/15 text-red-400 border-red-500/30",
  "Partially Supported": "bg-lime-500/15 text-lime-400 border-lime-500/30",
  "Ambiguous": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Insufficient Evidence": "bg-violet-500/15 text-violet-400 border-violet-500/30",
  "Needs Expert Review": "bg-orange-500/15 text-orange-400 border-orange-500/30",
  "Out of Scope": "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

const ENTITY_TYPE_COLOR: Record<string, string> = {
  protein: "bg-violet-500/15 text-violet-300",
  pdb_id: "bg-sky-500/15 text-sky-300",
  method: "bg-orange-500/15 text-orange-300",
  organism: "bg-green-500/15 text-green-300",
  ligand: "bg-pink-500/15 text-pink-300",
  author: "bg-yellow-500/15 text-yellow-300",
  concept: "bg-slate-500/15 text-slate-300",
  document: "bg-blue-500/15 text-blue-300",
};

// ─── Highlight helper ─────────────────────────────────────────────────────────

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (terms.length === 0) return text;

  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    pattern.test(part) ? (
      <mark key={i} className="bg-yellow-400/25 text-yellow-200 rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

// ─── Relevance bar ────────────────────────────────────────────────────────────

function RelevanceBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.min((score / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500">{score}</span>
    </div>
  );
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400";
  return <span className={cn("text-[10px] font-mono", color)}>{pct}%</span>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Search() {
  const [, navigate] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState("");
  const [verticalDomain, setVerticalDomain] = useState<string>("all");
  const [verdict, setVerdict] = useState<string>("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, isFetching } = trpc.search.unified.useQuery(
    {
      query,
      claimLimit: 30,
      entityLimit: 8,
      verticalDomain: verticalDomain === "all" ? undefined : verticalDomain,
      verdict: verdict === "all" ? undefined : verdict,
    },
    {
      enabled: query.length >= 2,
    }
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(val);
    }, 350);
  }, []);

  const maxScore = data?.claims.reduce((m, c) => Math.max(m, c.relevanceScore), 0) ?? 0;
  const hasResults = (data?.totalClaims ?? 0) > 0 || (data?.totalEntities ?? 0) > 0;
  const showEmpty = query.length >= 2 && !isLoading && !isFetching && !hasResults;

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-white/10 bg-[#0f1525]/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="text-slate-400 hover:text-white transition-colors text-sm flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Home
          </button>
          <div className="flex-1 relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={inputValue}
              onChange={handleInput}
              placeholder="Search claims, proteins, methods, organisms…"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
            {isFetching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </div>

        {/* ── Filters ──────────────────────────────────────────────────────── */}
        <div className="max-w-5xl mx-auto px-6 pb-3 flex items-center gap-3 flex-wrap">
          <Select value={verticalDomain} onValueChange={setVerticalDomain}>
            <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10 text-slate-300 w-44">
              <SelectValue placeholder="All verticals" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All verticals</SelectItem>
              <SelectItem value="structural_biology">Structural Biology</SelectItem>
              <SelectItem value="salmon_biotech">Salmon Biotech</SelectItem>
              <SelectItem value="protein_supplement">Protein Supplements</SelectItem>
              <SelectItem value="creatine_ergogenics">Creatine & Ergogenics</SelectItem>
              <SelectItem value="gut_microbiome">Gut Microbiome</SelectItem>
              <SelectItem value="collagen_peptides">Collagen & Peptides</SelectItem>
              <SelectItem value="plant_based_protein">Plant-Based Protein</SelectItem>
              <SelectItem value="sports_nutrition_rct">Sports Nutrition RCTs</SelectItem>
            </SelectContent>
          </Select>

          <Select value={verdict} onValueChange={setVerdict}>
            <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10 text-slate-300 w-44">
              <SelectValue placeholder="All verdicts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All verdicts</SelectItem>
              <SelectItem value="Supported">Supported</SelectItem>
              <SelectItem value="Contradicted">Contradicted</SelectItem>
              <SelectItem value="Partially Supported">Partially Supported</SelectItem>
              <SelectItem value="Ambiguous">Ambiguous</SelectItem>
              <SelectItem value="Insufficient Evidence">Insufficient Evidence</SelectItem>
              <SelectItem value="Needs Expert Review">Needs Expert Review</SelectItem>
            </SelectContent>
          </Select>

          {data && (
            <span className="text-[11px] text-slate-500 ml-auto">
              {data.totalClaims} claim{data.totalClaims !== 1 ? "s" : ""}
              {data.totalEntities > 0 ? ` · ${data.totalEntities} entit${data.totalEntities !== 1 ? "ies" : "y"}` : ""}
              {" "}in {data.durationMs}ms
            </span>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">

        {/* Prompt */}
        {query.length < 2 && (
          <div className="text-center py-20 space-y-3">
            <p className="text-2xl font-semibold text-white/80">Search the evidence base</p>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              Search across {3820}+ verified claims, proteins, methods, and organisms from peer-reviewed literature.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {["creatine monohydrate", "whey protein synthesis", "collagen joint", "leucine mTOR", "gut microbiome diversity"].map((s) => (
                <button
                  key={s}
                  onClick={() => { setInputValue(s); setQuery(s); }}
                  className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-full px-3 py-1.5 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading && query.length >= 2 && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white/5 rounded-xl p-4 space-y-2">
                <Skeleton className="h-4 w-3/4 bg-white/10" />
                <Skeleton className="h-3 w-1/3 bg-white/5" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {showEmpty && (
          <div className="text-center py-16 space-y-2">
            <p className="text-white/60 text-lg">No results for "{query}"</p>
            <p className="text-slate-500 text-sm">Try different keywords or remove filters.</p>
          </div>
        )}

        {/* Entity results */}
        {data && data.entities.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Knowledge Graph Entities
            </h2>
            <div className="flex flex-wrap gap-2">
              {data.entities.map((e) => (
                <button
                  key={e.id}
                  onClick={() => navigate(`/wiki/${e.entityType}/${encodeURIComponent(e.canonicalName.replace(/ /g, "_"))}`)}
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 transition-colors group"
                >
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono", ENTITY_TYPE_COLOR[e.entityType] ?? "bg-slate-500/15 text-slate-300")}>
                    {e.entityType}
                  </span>
                  <span className="text-sm text-white group-hover:text-blue-300 transition-colors">
                    {highlight(e.canonicalName, query)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Claim results */}
        {data && data.claims.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Claims ({data.totalClaims})
            </h2>
            <div className="space-y-2">
              {data.claims.map((claim) => (
                <div
                  key={claim.id}
                  className="bg-white/5 hover:bg-white/[0.07] border border-white/10 rounded-xl p-4 transition-colors cursor-pointer group"
                  onClick={() => navigate(`/reports/${claim.documentId}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-slate-200 leading-relaxed group-hover:text-white transition-colors flex-1">
                      {highlight(claim.claimText, query)}
                    </p>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {claim.verdict && (
                        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", VERDICT_COLOR[claim.verdict] ?? "bg-slate-500/15 text-slate-400 border-slate-500/30")}>
                          {claim.verdict}
                        </span>
                      )}
                      <ConfidenceBadge score={claim.confidenceScore} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2.5">
                    <RelevanceBar score={claim.relevanceScore} max={maxScore} />
                    {claim.documentTitle && (
                      <span className="text-[10px] text-slate-500 truncate max-w-xs">
                        {claim.documentTitle}
                      </span>
                    )}
                    {claim.verticalDomain && (
                      <span className="text-[10px] text-slate-600 ml-auto">
                        {claim.verticalDomain.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
