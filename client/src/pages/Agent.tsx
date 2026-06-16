/**
 * Agent.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The Manus-style agent UI.
 *
 * Shows the three-agent pipeline live:
 *   Planner → Executor → Verifier
 *
 * User submits a natural language question.
 * Each claim is verified against live primary sources.
 * Results show verdict + sentence-level provenance per claim.
 */

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentEvidence {
  pmid?: string;
  sourceId?: string;
  title: string;
  sentence: string;
  url: string;
}

interface AgentClaimResult {
  text: string;
  domain: string;
  verdict: string;
  confidence: number;
  evidence: AgentEvidence | null;
}

interface AgentResponse {
  question: string;
  overallVerdict: string;
  latencyMs: number;
  claims: AgentClaimResult[];
}

// ─── Verdict colours ──────────────────────────────────────────────────────────

const VERDICT_STYLES: Record<
  string,
  { bg: string; text: string; dot: string }
> = {
  Supported: {
    bg: "bg-emerald-950/60",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
  },
  "Partially Supported": {
    bg: "bg-yellow-950/60",
    text: "text-yellow-300",
    dot: "bg-yellow-400",
  },
  Contradicted: {
    bg: "bg-red-950/60",
    text: "text-red-300",
    dot: "bg-red-400",
  },
  "Insufficient Evidence": {
    bg: "bg-zinc-800/60",
    text: "text-zinc-400",
    dot: "bg-zinc-500",
  },
};

function verdictStyle(v: string) {
  return VERDICT_STYLES[v] ?? VERDICT_STYLES["Insufficient Evidence"];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PipelineStep({
  step,
  label,
  active,
  done,
}: {
  step: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-all duration-300 ${
          done
            ? "bg-emerald-500 border-emerald-400 text-white"
            : active
              ? "bg-indigo-600 border-indigo-400 text-white animate-pulse"
              : "bg-zinc-800 border-zinc-700 text-zinc-500"
        }`}
      >
        {done ? "✓" : step}
      </div>
      <span
        className={`text-sm font-medium transition-colors duration-300 ${
          done
            ? "text-emerald-300"
            : active
              ? "text-indigo-300"
              : "text-zinc-500"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function ClaimCard({ claim }: { claim: AgentClaimResult }) {
  const vs = verdictStyle(claim.verdict);
  const pct = Math.round(claim.confidence * 100);

  return (
    <div
      className={`rounded-xl border border-zinc-700/50 p-4 ${vs.bg} transition-all`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm text-zinc-200 leading-relaxed flex-1">
          {claim.text}
        </p>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${vs.text}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${vs.dot}`} />
            {claim.verdict}
          </span>
          <span className="text-xs text-zinc-500">{pct}% confidence</span>
        </div>
      </div>

      {/* Domain badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs px-2 py-0.5 rounded bg-zinc-700/60 text-zinc-400 font-mono">
          {claim.domain}
        </span>
      </div>

      {/* Evidence */}
      {claim.evidence ? (
        <div className="border-t border-zinc-700/40 pt-3 space-y-1">
          <p className="text-xs text-zinc-400 font-medium">
            Supporting evidence
          </p>
          <p className="text-xs text-zinc-300 italic leading-relaxed">
            &ldquo;{claim.evidence.sentence}&rdquo;
          </p>
          <a
            href={claim.evidence.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
          >
            {claim.evidence.pmid
              ? `PMID ${claim.evidence.pmid}`
              : (claim.evidence.sourceId ?? "Source")}{" "}
            — {claim.evidence.title}
          </a>
        </div>
      ) : (
        <div className="border-t border-zinc-700/40 pt-3">
          <p className="text-xs text-zinc-600 italic">
            No evidence found in primary sources.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Example questions ────────────────────────────────────────────────────────

const EXAMPLES = [
  "Does aspirin reduce cardiovascular risk in adults over 50?",
  "Is CRISPR-Cas9 effective for treating sickle cell disease?",
  "Does the BRCA1 mutation increase breast cancer risk?",
  "Is lysozyme found in human tears?",
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Agent() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0); // 0=idle, 1=plan, 2=exec, 3=verify
  const [result, setResult] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(q: string) {
    if (!q.trim()) return;
    setQuestion(q);
    setLoading(true);
    setResult(null);
    setError(null);
    setPhase(1);

    // Simulate pipeline phases visually
    const phaseTimer = setTimeout(() => setPhase(2), 600);
    const phaseTimer2 = setTimeout(() => setPhase(3), 1200);

    try {
      const res = await fetch("/api/public/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.trim() }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data: AgentResponse = await res.json();
      setResult(data);
      setPhase(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase(0);
    } finally {
      clearTimeout(phaseTimer);
      clearTimeout(phaseTimer2);
      setLoading(false);
    }
  }

  const overallVs = result ? verdictStyle(result.overallVerdict) : null;

  return (
    <div className="min-h-screen bg-[#0d0b12] text-zinc-100 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            citation<span className="text-indigo-400">.is</span> Agent
          </h1>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Submit any scientific question. The agent decomposes it into atomic
            claims, routes each to the correct primary source, and returns a
            verdict with provenance.
          </p>
        </div>

        {/* Pipeline indicator */}
        <div className="flex items-center justify-center gap-4">
          <PipelineStep
            step={1}
            label="Planner"
            active={phase === 1}
            done={phase > 1}
          />
          <div className="w-8 h-px bg-zinc-700" />
          <PipelineStep
            step={2}
            label="Executor"
            active={phase === 2}
            done={phase > 2}
          />
          <div className="w-8 h-px bg-zinc-700" />
          <PipelineStep
            step={3}
            label="Verifier"
            active={phase === 3 && loading}
            done={!loading && phase === 3 && !!result}
          />
        </div>

        {/* Input */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit(question)}
              placeholder="Ask a scientific question…"
              disabled={loading}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition"
            />
            <button
              onClick={() => submit(question)}
              disabled={loading || !question.trim()}
              className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg text-sm font-semibold text-white transition-colors"
            >
              {loading ? "…" : "Verify"}
            </button>
          </div>

          {/* Example questions */}
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => submit(ex)}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40 border border-zinc-700"
              >
                {ex.length > 50 ? ex.slice(0, 50) + "…" : ex}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-950/50 border border-red-800 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Overall verdict banner */}
            <div
              className={`rounded-xl border border-zinc-700/50 px-5 py-4 flex items-center justify-between ${overallVs?.bg}`}
            >
              <div>
                <p className="text-xs text-zinc-500 mb-0.5">Overall verdict</p>
                <p className={`text-lg font-bold ${overallVs?.text}`}>
                  {result.overallVerdict}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500 mb-0.5">Latency</p>
                <p className="text-sm font-mono text-zinc-300">
                  {result.latencyMs.toLocaleString()} ms
                </p>
              </div>
            </div>

            {/* Per-claim cards */}
            {result.claims.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                  {result.claims.length} atomic claim
                  {result.claims.length !== 1 ? "s" : ""} verified
                </p>
                {result.claims.map((c, i) => (
                  <ClaimCard key={i} claim={c} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 text-center py-4">
                No verifiable claims found in the question.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
