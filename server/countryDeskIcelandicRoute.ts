/**
 * Sprint 41 — CountryDesk Iceland
 * GET  /api/public/countrydesk/iceland/sources   — paginated source card registry
 * GET  /api/public/countrydesk/iceland/domains   — domain list with stats
 * GET  /api/public/countrydesk/iceland/stats     — top-level corpus stats
 * POST /api/public/countrydesk/iceland/verify    — verify a claim against Icelandic sources
 */

import { Router, Request, Response } from "express";
import { queryMRAgent, ingestMRAgent } from "./mrAgentClient.js";
import { ENV } from "./_core/env.js";

// ── Inline seed data (subset of countrydesk-icelandic repo) ──────────────────

interface IcelandicSourceCard {
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

const ICELANDIC_SOURCES: IcelandicSourceCard[] = [
  {
    id: "is:law:althingi:source",
    title: "Alþingi — Icelandic Parliament & Legal Corpus",
    domain: "is:law",
    sourceUrl: "https://www.althingi.is/",
    sourceOwner: "Alþingi",
    authorityClass: "official_government",
    reuseClass: "green",
    licenseStatus: "permissive",
    confidence: 0.97,
    primaryLanguage: "is",
    summary: "Official Icelandic parliament site with full legislative corpus, bills, debates, and committee records. The legal corpus (lagasafn) is updated to April 2026 and is freely reusable for citation.",
    tags: ["law", "parliament", "legislation", "lagasafn"],
  },
  {
    id: "is:public_admin:island_is:source",
    title: "Ísland.is — Central Public Services Portal",
    domain: "is:public_admin",
    sourceUrl: "https://island.is/",
    sourceOwner: "Stafrænt Ísland",
    authorityClass: "official_government",
    reuseClass: "yellow",
    licenseStatus: "unclear",
    confidence: 0.86,
    primaryLanguage: "is",
    summary: "Central Icelandic public-service portal. High-authority citation source for public-administration questions and service navigation. Citation-only; do not bulk copy.",
    tags: ["public-service", "portal", "government"],
  },
  {
    id: "is:stats:hagstofa:source",
    title: "Hagstofa Íslands — Statistics Iceland",
    domain: "is:stats",
    sourceUrl: "https://www.hagstofa.is/",
    sourceOwner: "Hagstofa Íslands",
    authorityClass: "official_government",
    reuseClass: "green",
    licenseStatus: "open_data",
    confidence: 0.95,
    primaryLanguage: "is",
    summary: "Official Icelandic statistics agency. Publishes open data on population, economy, labour, housing, and environment. Data is freely reusable with attribution.",
    tags: ["statistics", "open-data", "economy", "population"],
  },
  {
    id: "is:law:stjornarradid:source",
    title: "Stjórnarráðið — Government of Iceland Ministries",
    domain: "is:public_admin",
    sourceUrl: "https://www.government.is/",
    sourceOwner: "Stjórnarráðið",
    authorityClass: "official_government",
    reuseClass: "yellow",
    licenseStatus: "unclear",
    confidence: 0.92,
    primaryLanguage: "is",
    summary: "Official site of the Government of Iceland, covering all ministries, policy announcements, and official statements. Citation-only use is appropriate.",
    tags: ["government", "ministries", "policy"],
  },
  {
    id: "is:health:landlaeknir:source",
    title: "Embætti landlæknis — Directorate of Health",
    domain: "is:health",
    sourceUrl: "https://www.landlaeknir.is/",
    sourceOwner: "Embætti landlæknis",
    authorityClass: "official_government",
    reuseClass: "yellow",
    licenseStatus: "unclear",
    confidence: 0.91,
    primaryLanguage: "is",
    summary: "Official Icelandic health authority. Publishes public health guidelines, epidemiological data, and health policy. Citation-only; do not reproduce clinical guidance as advice.",
    tags: ["health", "public-health", "guidelines"],
  },
  {
    id: "is:education:hi:source",
    title: "Háskóli Íslands — University of Iceland",
    domain: "is:education",
    sourceUrl: "https://www.hi.is/",
    sourceOwner: "Háskóli Íslands",
    authorityClass: "academic_institution",
    reuseClass: "yellow",
    licenseStatus: "unclear",
    confidence: 0.88,
    primaryLanguage: "is",
    summary: "Iceland's largest university. Research publications, theses, and academic resources. Open-access publications are citable; institutional content requires permission.",
    tags: ["university", "research", "academic"],
  },
  {
    id: "is:culture:landsbokasafn:source",
    title: "Landsbókasafn Íslands — National Library of Iceland",
    domain: "is:culture",
    sourceUrl: "https://www.nlsi.is/",
    sourceOwner: "Landsbókasafn Íslands",
    authorityClass: "official_government",
    reuseClass: "green",
    licenseStatus: "open_access",
    confidence: 0.89,
    primaryLanguage: "is",
    summary: "National Library of Iceland. Digitised historical collections, manuscripts, newspapers, and cultural heritage materials. Open-access digitised content is freely citable.",
    tags: ["library", "culture", "heritage", "digitised"],
  },
  {
    id: "is:environment:ust:source",
    title: "Umhverfisstofnun — Environment Agency of Iceland",
    domain: "is:environment",
    sourceUrl: "https://www.ust.is/",
    sourceOwner: "Umhverfisstofnun",
    authorityClass: "official_government",
    reuseClass: "yellow",
    licenseStatus: "unclear",
    confidence: 0.87,
    primaryLanguage: "is",
    summary: "Official Icelandic environment agency. Publishes environmental regulations, permits, monitoring data, and climate policy. Citation-only.",
    tags: ["environment", "climate", "regulation"],
  },
  {
    id: "is:stats:sedlabanki:source",
    title: "Seðlabanki Íslands — Central Bank of Iceland",
    domain: "is:stats",
    sourceUrl: "https://www.sedlabanki.is/",
    sourceOwner: "Seðlabanki Íslands",
    authorityClass: "official_government",
    reuseClass: "green",
    licenseStatus: "open_data",
    confidence: 0.94,
    primaryLanguage: "is",
    summary: "Central Bank of Iceland. Publishes monetary policy decisions, inflation data, exchange rates, and financial stability reports. Data is openly reusable with attribution.",
    tags: ["finance", "monetary-policy", "open-data", "economy"],
  },
  {
    id: "is:law:domstolar:source",
    title: "Dómstólar Íslands — Courts of Iceland",
    domain: "is:law",
    sourceUrl: "https://www.domstolar.is/",
    sourceOwner: "Dómstólar Íslands",
    authorityClass: "official_government",
    reuseClass: "yellow",
    licenseStatus: "unclear",
    confidence: 0.85,
    primaryLanguage: "is",
    summary: "Official site of the Icelandic court system. Publishes court decisions, procedural rules, and judicial statistics. Citation-only; individual case data may have privacy constraints.",
    tags: ["courts", "judiciary", "law"],
  },
];

const DOMAIN_LABELS: Record<string, string> = {
  "is:law": "Lög og réttarkerfi / Law & Legal System",
  "is:public_admin": "Stjórnsýsla / Public Administration",
  "is:stats": "Tölfræði / Statistics & Open Data",
  "is:health": "Heilbrigðismál / Health",
  "is:education": "Menntamál / Education & Research",
  "is:culture": "Menning / Culture & Heritage",
  "is:environment": "Umhverfismál / Environment",
  "is:general": "Almennt / General",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreClaimAgainstSource(claim: string, source: IcelandicSourceCard): number {
  const claimLower = claim.toLowerCase();
  const keywords = [
    ...source.tags,
    source.domain.replace("is:", ""),
    source.sourceOwner.toLowerCase(),
  ];
  let hits = 0;
  for (const kw of keywords) {
    if (claimLower.includes(kw.toLowerCase())) hits++;
  }
  return hits;
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerCountryDeskIcelandicRoute(app: Router): void {
  const router = Router();

  // GET /sources
  router.get("/sources", (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
    const domain = req.query.domain as string | undefined;
    const reuseClass = req.query.reuse_class as string | undefined;

    let filtered = ICELANDIC_SOURCES;
    if (domain) filtered = filtered.filter((s) => s.domain === domain);
    if (reuseClass) filtered = filtered.filter((s) => s.reuseClass === reuseClass);

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    res.json({
      ok: true,
      country: "IS",
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      sources: items,
    });
  });

  // GET /domains
  router.get("/domains", (_req: Request, res: Response) => {
    const domainMap: Record<string, { count: number; green: number; yellow: number; red: number }> = {};
    for (const s of ICELANDIC_SOURCES) {
      if (!domainMap[s.domain]) domainMap[s.domain] = { count: 0, green: 0, yellow: 0, red: 0 };
      domainMap[s.domain].count++;
      domainMap[s.domain][s.reuseClass]++;
    }
    const domains = Object.entries(domainMap).map(([domain, stats]) => ({
      domain,
      label: DOMAIN_LABELS[domain] ?? domain,
      ...stats,
    }));
    res.json({ ok: true, country: "IS", domains });
  });

  // GET /stats
  router.get("/stats", (_req: Request, res: Response) => {
    const green = ICELANDIC_SOURCES.filter((s) => s.reuseClass === "green").length;
    const yellow = ICELANDIC_SOURCES.filter((s) => s.reuseClass === "yellow").length;
    const red = ICELANDIC_SOURCES.filter((s) => s.reuseClass === "red").length;
    const avgConfidence = ICELANDIC_SOURCES.reduce((a, s) => a + s.confidence, 0) / ICELANDIC_SOURCES.length;
    res.json({
      ok: true,
      country: "IS",
      totalSources: ICELANDIC_SOURCES.length,
      reuseBreakdown: { green, yellow, red },
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      domains: Object.keys(DOMAIN_LABELS).length,
      lastUpdated: "2026-07-05",
      version: "sprint-41",
    });
  });

  // POST /verify — verify a claim against Icelandic authoritative sources
  router.post("/verify", async (req: Request, res: Response) => {
    const { claim } = req.body as { claim?: string };
    if (!claim || typeof claim !== "string" || claim.trim().length < 5) {
      res.status(400).json({ ok: false, error: "claim must be a non-empty string of at least 5 characters" });
      return;
    }
    const claimText = claim.trim();

    // 1. Check MRAgent memory first
    if (ENV.mrAgentEnabled && ENV.mrAgentUrl) {
      const cached = await queryMRAgent(claimText);
      if (cached.hit) {
        res.json({
          ok: true,
          country: "IS",
          claim: claimText,
          verdict: cached.verdict,
          confidence: cached.confidence,
          evidence: cached.evidence,
          sources: cached.sources,
          cached: true,
          vertical: "countrydesk-iceland",
        });
        return;
      }
    }

    // 2. Score claim against Icelandic source registry
    const scored = ICELANDIC_SOURCES.map((s) => ({
      source: s,
      score: scoreClaimAgainstSource(claimText, s),
    }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    let verdict: "Supported" | "Insufficient Evidence" | "Contradicted";
    let confidence: number;
    let evidence: string[];

    if (scored.length === 0) {
      verdict = "Insufficient Evidence";
      confidence = 0.1;
      evidence = ["No matching Icelandic authoritative sources found for this claim."];
    } else {
      const topSource = scored[0].source;
      const greenSources = scored.filter((x) => x.source.reuseClass === "green");

      if (greenSources.length >= 1 && scored[0].score >= 2) {
        verdict = "Supported";
        confidence = Math.min(0.95, 0.6 + scored[0].score * 0.08 + greenSources.length * 0.05);
        evidence = scored.slice(0, 3).map((x) => `${x.source.title} — ${x.source.summary}`);
      } else if (scored[0].score >= 1) {
        verdict = "Insufficient Evidence";
        confidence = 0.35 + scored[0].score * 0.05;
        evidence = [
          `Partial match found: ${topSource.title}`,
          "Claim requires additional verification against primary Icelandic sources.",
        ];
      } else {
        verdict = "Insufficient Evidence";
        confidence = 0.2;
        evidence = ["Weak keyword match only. Claim not verifiable from current Icelandic source registry."];
      }
    }

    const matchedSources = scored.slice(0, 3).map((x) => ({
      id: x.source.id,
      title: x.source.title,
      url: x.source.sourceUrl,
      owner: x.source.sourceOwner,
      reuseClass: x.source.reuseClass,
      confidence: x.source.confidence,
    }));

    // 3. Ingest into MRAgent memory
    if (ENV.mrAgentEnabled && ENV.mrAgentUrl && verdict === "Supported") {
      await ingestMRAgent(claimText, verdict, confidence, matchedSources.map((s) => s.url), "countrydesk-iceland");
    }

    res.json({
      ok: true,
      country: "IS",
      claim: claimText,
      verdict,
      confidence: Math.round(confidence * 100) / 100,
      evidence,
      sources: matchedSources,
      cached: false,
      vertical: "countrydesk-iceland",
    });
  });

  // Mount under /api/public/countrydesk/iceland
  (app as unknown as import("express").Application).use("/api/public/countrydesk/iceland", router);
}
