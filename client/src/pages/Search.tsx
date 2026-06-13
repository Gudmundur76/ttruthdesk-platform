import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClaimSearchResult {
  id: number;
  claimText: string;
  verdict: string | null;
  confidenceScore: number | null;
  documentId: number | null;
  documentTitle: string | null;
  verticalDomain: string | null;
  relevanceScore: number;
}

interface EntitySearchResult {
  id: number;
  canonicalName: string;
  entityType: string;
  firstSeenDocumentId: number | null;
  relationCount: number;
  relevanceScore: number;
}

interface SemanticHit {
  claimId: number;
  score: number;
  claimText: string;
  verdict: string | null;
  documentId: number | null;
  documentTitle: string | null;
  verticalDomain: string | null;
  source: "vector" | "fulltext";
}

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

// ─── Similarity badge (for TurboVec results) ──────────────────────────────────

function SimilarityBadge({ score, source }: { score: number; source: "vector" | "fulltext" }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-slate-400";
  return (
    <span className={cn("text-[10px] font-mono flex items-center gap-1", color)}>
      {source === "vector" ? (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
      ) : (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
      )}
      {pct}%
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export default function Search() {
  const [, navigate] = useLocation();
  // Pre-populate from ?q= URL param on mount
  const [inputValue, setInputValue] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  const [query, setQuery] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  const [verticalDomain, setVerticalDomain] = useState<string>("all");
  const [verdict, setVerdict] = useState<string>("all");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Keyword (unified) search ──────────────────────────────────────────────
  const {
    data: keywordData,
    isLoading: keywordLoading,
    isFetching: keywordFetching,
  } = trpc.search.unified.useQuery(
    {
      query,
      claimLimit: 30,
      entityLimit: 8,
      verticalDomain: verticalDomain === "all" ? undefined : verticalDomain,
      verdict: verdict === "all" ? undefined : verdict,
    },
    { enabled: mode === "keyword" && query.length >= 2 }
  );

  // ── TurboVec semantic search ──────────────────────────────────────────────
  const {
    data: semanticData,
    isLoading: semanticLoading,
    isFetching: semanticFetching,
  } = trpc.search.similar.useQuery(
    {
      query,
      topK: 20,
      vertical: verticalDomain === "all" ? undefined : verticalDomain,
      verdict: verdict === "all" ? undefined : verdict,
    },
    { enabled: mode === "semantic" && query.length >= 1 }
  );

  // ── Sidecar health (shown in semantic mode) ───────────────────────────────
  const { data: vectorHealth } = trpc.search.vectorHealth.useQuery(undefined, {
    enabled: mode === "semantic",
    staleTime: 30_000,
  });

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(val);
    }, 350);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const isLoading = mode === "keyword" ? keywordLoading : semanticLoading;
  const isFetching = mode === "keyword" ? keywordFetching : semanticFetching;

  const keywordClaims: ClaimSearchResult[] = (keywordData?.claims ?? []) as ClaimSearchResult[];
  const keywordEntities: EntitySearchResult[] = (keywordData?.entities ?? []) as EntitySearchResult[];
  const semanticHits: SemanticHit[] = (semanticData?.hits ?? []) as SemanticHit[];

  const maxScore = keywordClaims.reduce((m: number, c: ClaimSearchResult) => Math.max(m, c.relevanceScore), 0);
  const maxSemScore = semanticHits.reduce((m: number, h: SemanticHit) => Math.max(m, h.score), 0);

  const hasKeywordResults = (keywordData?.totalClaims ?? 0) > 0 || (keywordData?.totalEntities ?? 0) > 0;
  const hasSemanticResults = semanticHits.length > 0;
  const hasResults = mode === "keyword" ? hasKeywordResults : hasSemanticResults;
  const minLen = mode === "keyword" ? 2 : 1;
  const showEmpty = query.length >= minLen && !isLoading && !isFetching && !hasResults;

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
              placeholder={mode === "semantic" ? "Ask a question or describe a concept…" : "Search claims, proteins, methods, organisms…"}
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
            {isFetching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5 gap-0.5 flex-shrink-0">
            <button
              onClick={() => setMode("keyword")}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md transition-colors",
                mode === "keyword" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              )}
            >
              Keyword
            </button>
            <button
              onClick={() => setMode("semantic")}
              className={cn(
                "text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5",
                mode === "semantic" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
              )}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" opacity="0.8">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Semantic
            </button>
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
              <SelectItem value="creatine_ergogenics">Creatine &amp; Ergogenics</SelectItem>
              <SelectItem value="gut_microbiome">Gut Microbiome</SelectItem>
              <SelectItem value="collagen_peptides">Collagen &amp; Peptides</SelectItem>
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

          {/* Sidecar status pill (semantic mode only) */}
          {mode === "semantic" && vectorHealth !== undefined && (
            <span className={cn(
              "text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1",
              vectorHealth.available
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/20"
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full", vectorHealth.available ? "bg-emerald-400" : "bg-amber-400")} />
              {vectorHealth.available
                ? `TurboVec · ${vectorHealth.indexed} indexed`
                : "SQL fallback active"}
            </span>
          )}

          {mode === "keyword" && keywordData && (
            <span className="text-[11px] text-slate-500 ml-auto">
              {keywordData.totalClaims} claim{keywordData.totalClaims !== 1 ? "s" : ""}
              {keywordData.totalEntities > 0 ? ` · ${keywordData.totalEntities} entit${keywordData.totalEntities !== 1 ? "ies" : "y"}` : ""}
              {" "}in {keywordData.durationMs}ms
            </span>
          )}
          {mode === "semantic" && semanticData && (
            <span className="text-[11px] text-slate-500 ml-auto">
              {semanticHits.length} result{semanticHits.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">

        {/* Prompt */}
        {query.length < minLen && (
          <div className="text-center py-20 space-y-3">
            <p className="text-2xl font-semibold text-white/80">
              {mode === "semantic" ? "Ask the evidence base" : "Search the evidence base"}
            </p>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              {mode === "semantic"
                ? "Natural-language semantic search powered by TurboVec (FAISS + sentence-transformers). Falls back to SQL full-text if the vector sidecar is not running."
                : "Search across verified claims, proteins, methods, and organisms from peer-reviewed literature."}
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {(mode === "semantic"
                ? ["Does creatine improve strength?", "Whey protein and muscle synthesis", "Collagen supplementation joints", "Leucine activates mTOR", "Gut microbiome diversity and health"]
                : ["creatine monohydrate", "whey protein synthesis", "collagen joint", "leucine mTOR", "gut microbiome diversity"]
              ).map((s) => (
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
        {isLoading && query.length >= minLen && (
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

        {/* ── Keyword mode results ──────────────────────────────────────────── */}
        {mode === "keyword" && (
          <>
            {/* Entity results */}
            {keywordEntities.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Knowledge Graph Entities
                </h2>
                <div className="flex flex-wrap gap-2">
                  {keywordEntities.map((e: EntitySearchResult) => (
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
            {keywordClaims.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Claims ({keywordData?.totalClaims ?? 0})
                </h2>
                <div className="space-y-2">
                  {keywordClaims.map((claim: ClaimSearchResult) => (
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
          </>
        )}

        {/* ── Semantic mode results ─────────────────────────────────────────── */}
        {mode === "semantic" && semanticHits.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              Semantic Matches ({semanticHits.length})
              {vectorHealth && !vectorHealth.available && (
                <span className="text-amber-500 font-normal normal-case tracking-normal ml-1">(SQL fallback)</span>
              )}
            </h2>
            <div className="space-y-2">
              {semanticHits.map((hit: SemanticHit) => (
                <div
                  key={hit.claimId}
                  className="bg-white/5 hover:bg-white/[0.07] border border-white/10 rounded-xl p-4 transition-colors cursor-pointer group"
                  onClick={() => hit.documentId && navigate(`/reports/${hit.documentId}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-slate-200 leading-relaxed group-hover:text-white transition-colors flex-1">
                      {highlight(hit.claimText, query)}
                    </p>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {hit.verdict && (
                        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", VERDICT_COLOR[hit.verdict] ?? "bg-slate-500/15 text-slate-400 border-slate-500/30")}>
                          {hit.verdict}
                        </span>
                      )}
                      <SimilarityBadge score={hit.score} source={hit.source} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2.5">
                    <RelevanceBar score={hit.score} max={maxSemScore} />
                    {hit.documentTitle && (
                      <span className="text-[10px] text-slate-500 truncate max-w-xs">
                        {hit.documentTitle}
                      </span>
                    )}
                    {hit.verticalDomain && (
                      <span className="text-[10px] text-slate-600 ml-auto">
                        {hit.verticalDomain.replace(/_/g, " ")}
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
