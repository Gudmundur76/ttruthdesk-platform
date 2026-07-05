import { useState, useEffect } from "react";
import { Link } from "wouter";

interface SourceCard {
  id: string;
  title: string;
  domain: string;
  sourceUrl: string;
  sourceOwner: string;
  authorityClass: string;
  reuseClass: "green" | "yellow" | "red";
  licenseStatus: string;
  confidence: number;
  primaryLanguage: string;
  summary: string;
  tags: string[];
}

interface DomainStat {
  domain: string;
  label: string;
  count: number;
  green: number;
  yellow: number;
  red: number;
}

interface CorpusStats {
  totalSources: number;
  reuseBreakdown: { green: number; yellow: number; red: number };
  avgConfidence: number;
  domains: number;
  lastUpdated: string;
}

interface VerifyResult {
  verdict: "Supported" | "Insufficient Evidence" | "Contradicted";
  confidence: number;
  evidence: string[];
  sources: { id: string; title: string; url: string; owner: string; reuseClass: string }[];
  cached: boolean;
}

const REUSE_COLORS: Record<string, string> = {
  green: "bg-green-100 text-green-800 border-green-200",
  yellow: "bg-yellow-100 text-yellow-800 border-yellow-200",
  red: "bg-red-100 text-red-800 border-red-200",
};

const VERDICT_COLORS: Record<string, string> = {
  Supported: "bg-green-50 border-green-300 text-green-900",
  "Insufficient Evidence": "bg-yellow-50 border-yellow-300 text-yellow-900",
  Contradicted: "bg-red-50 border-red-300 text-red-900",
};

const EXAMPLE_CLAIMS = [
  "Alþingi er æðsta löggjafarvald á Íslandi",
  "Iceland has a population of approximately 370,000",
  "The Central Bank of Iceland sets monetary policy",
  "Icelandic law requires environmental impact assessments for major projects",
  "Háskóli Íslands is the largest university in Iceland",
];

const BASE = "/api/public/countrydesk/iceland";

export default function CountryDeskIceland() {
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [domains, setDomains] = useState<DomainStat[]>([]);
  const [sources, setSources] = useState<SourceCard[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [claim, setClaim] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/stats`)
      .then((r) => r.json())
      .then((d) => d.ok && setStats(d))
      .catch(() => null);

    fetch(`${BASE}/domains`)
      .then((r) => r.json())
      .then((d) => d.ok && setDomains(d.domains))
      .catch(() => null);

    fetch(`${BASE}/sources?limit=50`)
      .then((r) => r.json())
      .then((d) => d.ok && setSources(d.sources))
      .catch(() => null);
  }, []);

  useEffect(() => {
    const url = selectedDomain
      ? `${BASE}/sources?domain=${encodeURIComponent(selectedDomain)}&limit=50`
      : `${BASE}/sources?limit=50`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => d.ok && setSources(d.sources))
      .catch(() => null);
  }, [selectedDomain]);

  async function handleVerify() {
    if (!claim.trim()) return;
    setVerifying(true);
    setResult(null);
    setError(null);
    try {
      const r = await fetch(`${BASE}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.trim() }),
      });
      const d = await r.json();
      if (d.ok) setResult(d as VerifyResult);
      else setError(d.error ?? "Verification failed");
    } catch {
      setError("Network error — please try again");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🇮🇸</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">CountryDesk Iceland</h1>
              <p className="text-sm text-gray-500">Sovereign AI Trust Infrastructure · Powered by Xinapse.ai</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
              Dashboard
            </Link>
            <Link href="/verify" className="text-sm text-gray-500 hover:text-gray-700">
              Verify
            </Link>
            <a
              href="/api/public/countrydesk/iceland/stats"
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              API
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-sm font-medium px-4 py-1.5 rounded-full border border-blue-200">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            Live · Sprint 41
          </div>
          <h2 className="text-4xl font-bold text-gray-900">
            Icelandic AI Trust Map
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Every claim about Iceland verified against authoritative Icelandic sources —
            Alþingi, Hagstofa, Stjórnarráðið, and more. The first sovereign AI trust
            infrastructure for a Nordic nation.
          </p>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Authoritative Sources", value: stats.totalSources, icon: "📚" },
              { label: "Open / Reusable", value: stats.reuseBreakdown.green, icon: "✅" },
              { label: "Domains Covered", value: stats.domains, icon: "🗂️" },
              { label: "Avg Confidence", value: `${Math.round(stats.avgConfidence * 100)}%`, icon: "🎯" },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                <div className="text-2xl mb-1">{s.icon}</div>
                <div className="text-2xl font-bold text-gray-900">{s.value}</div>
                <div className="text-sm text-gray-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Verify panel */}
        <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-5">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Verify a Claim</h3>
            <p className="text-sm text-gray-500 mt-1">
              Submit any claim about Iceland in English or Icelandic. The system checks it
              against the authoritative source registry.
            </p>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              placeholder="e.g. Alþingi er æðsta löggjafarvald á Íslandi"
              className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleVerify}
              disabled={verifying || !claim.trim()}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {verifying ? "Verifying…" : "Verify"}
            </button>
          </div>

          {/* Example claims */}
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_CLAIMS.map((ex) => (
              <button
                key={ex}
                onClick={() => setClaim(ex)}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>

          {/* Result */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {result && (
            <div className={`rounded-xl border-2 p-6 space-y-4 ${VERDICT_COLORS[result.verdict]}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">
                    {result.verdict === "Supported" ? "✅" : result.verdict === "Contradicted" ? "❌" : "⚠️"}
                  </span>
                  <div>
                    <div className="font-bold text-lg">{result.verdict}</div>
                    <div className="text-sm opacity-75">
                      Confidence: {Math.round(result.confidence * 100)}%
                      {result.cached && " · from memory"}
                    </div>
                  </div>
                </div>
                <span className="text-xs bg-white bg-opacity-60 px-3 py-1 rounded-full font-medium">
                  🇮🇸 CountryDesk Iceland
                </span>
              </div>

              {result.evidence.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium opacity-75">Evidence</div>
                  {result.evidence.map((e, i) => (
                    <div key={i} className="text-sm bg-white bg-opacity-50 rounded-lg p-3">
                      {e}
                    </div>
                  ))}
                </div>
              )}

              {result.sources.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium opacity-75">Matched Sources</div>
                  {result.sources.map((s) => (
                    <a
                      key={s.id}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between bg-white bg-opacity-60 rounded-lg p-3 hover:bg-opacity-80 transition-all"
                    >
                      <div>
                        <div className="text-sm font-medium">{s.title}</div>
                        <div className="text-xs opacity-60">{s.owner}</div>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${REUSE_COLORS[s.reuseClass] ?? ""}`}
                      >
                        {s.reuseClass}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Domain filter + source registry */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-gray-900">Source Registry</h3>
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All domains</option>
              {domains.map((d) => (
                <option key={d.domain} value={d.domain}>
                  {d.label} ({d.count})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sources.map((s) => (
              <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <a
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                    >
                      {s.title}
                    </a>
                    <div className="text-sm text-gray-500 mt-0.5">{s.sourceOwner}</div>
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium ${REUSE_COLORS[s.reuseClass]}`}
                  >
                    {s.reuseClass}
                  </span>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{s.summary}</p>
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-1">
                    {s.tags.slice(0, 4).map((t) => (
                      <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {t}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-gray-400">
                    {Math.round(s.confidence * 100)}% confidence
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div className="text-center text-sm text-gray-400 pb-6">
          CountryDesk Iceland is part of the{" "}
          <a href="/" className="text-blue-500 hover:text-blue-700">
            citation.is
          </a>{" "}
          platform by Xinapse.ai · Sprint 41 · Sources last reviewed 2026-07-05
        </div>
      </div>
    </div>
  );
}
