/**
 * domainClassifier.test.ts — Sprint 26
 *
 * Tests for:
 *   - classifyClaim: all 15 domain rules + fallback
 *   - classifyClaims: batch classification
 *   - getPrimaryRoute: top-ranked source selection
 *   - getAllSourceIds: deduplication across results
 */
import { describe, it, expect } from "vitest";
import {
  classifyClaim,
  classifyClaims,
  getPrimaryRoute,
  getAllSourceIds,
} from "./domainClassifier";
import type { AtomicClaim } from "./questionDecomposer";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeClaim(text: string): AtomicClaim {
  return { text, method: "heuristic", confidence: 0.8, index: 0 };
}

// ─── classifyClaim: domain rules ─────────────────────────────────────────────

describe("classifyClaim — structural_biology", () => {
  it("routes 'protein structure' to rcsb_pdb", () => {
    const r = classifyClaim(
      makeClaim("The protein structure of EGFR was resolved at 2.5 Å.")
    );
    expect(r.domain).toBe("structural_biology");
    expect(r.routes[0].sourceId).toBe("rcsb_pdb");
    expect(r.routes[0].confidence).toBeGreaterThan(0.9);
  });

  it("routes 'cryo-EM structure' to rcsb_pdb", () => {
    const r = classifyClaim(
      makeClaim("The cryo-EM structure of the ribosome was determined.")
    );
    expect(r.domain).toBe("structural_biology");
    expect(r.routes[0].sourceId).toBe("rcsb_pdb");
  });

  it("routes 'active site' to rcsb_pdb", () => {
    const r = classifyClaim(makeClaim("The active site contains a zinc ion."));
    expect(r.domain).toBe("structural_biology");
    expect(r.routes[0].sourceId).toBe("rcsb_pdb");
  });
});

describe("classifyClaim — protein_biochemistry", () => {
  it("routes 'enzyme' to uniprot", () => {
    const r = classifyClaim(
      makeClaim("The enzyme catalase decomposes hydrogen peroxide.")
    );
    expect(r.domain).toBe("protein_biochemistry");
    expect(r.routes[0].sourceId).toBe("uniprot");
  });

  it("routes 'receptor' to uniprot", () => {
    const r = classifyClaim(
      makeClaim("The insulin receptor is a tyrosine kinase.")
    );
    expect(r.domain).toBe("protein_biochemistry");
    expect(r.routes[0].sourceId).toBe("uniprot");
  });
});

describe("classifyClaim — clinical_trial", () => {
  it("routes 'randomized controlled' to clinicaltrials_gov", () => {
    const r = classifyClaim(
      makeClaim(
        "A randomized controlled trial showed 30% reduction in mortality."
      )
    );
    expect(r.domain).toBe("clinical_trial");
    expect(r.routes[0].sourceId).toBe("clinicaltrials_gov");
  });

  it("routes 'phase III trial' to clinicaltrials_gov", () => {
    const r = classifyClaim(
      makeClaim("The phase III trial enrolled 1,200 patients.")
    );
    expect(r.domain).toBe("clinical_trial");
    expect(r.routes[0].sourceId).toBe("clinicaltrials_gov");
  });
});

describe("classifyClaim — pharmacology", () => {
  it("routes 'adverse event' to openfda", () => {
    const r = classifyClaim(
      makeClaim("The drug caused adverse events in 5% of patients.")
    );
    expect(r.domain).toBe("pharmacology");
    expect(r.routes[0].sourceId).toBe("openfda");
  });

  it("routes 'FDA approved' to openfda", () => {
    const r = classifyClaim(
      makeClaim("Metformin is FDA approved for type 2 diabetes.")
    );
    expect(r.domain).toBe("pharmacology");
    expect(r.routes[0].sourceId).toBe("openfda");
  });
});

describe("classifyClaim — genomics_genetics", () => {
  it("routes 'mutation' to clinvar", () => {
    const r = classifyClaim(
      makeClaim("The BRCA1 mutation increases breast cancer risk.")
    );
    expect(r.domain).toBe("genomics_genetics");
    expect(r.routes[0].sourceId).toBe("clinvar");
  });

  it("routes 'pathogenic variant' to clinvar", () => {
    const r = classifyClaim(
      makeClaim("This SNP is classified as pathogenic in ClinVar.")
    );
    expect(r.domain).toBe("genomics_genetics");
    expect(r.routes[0].sourceId).toBe("clinvar");
  });
});

describe("classifyClaim — food_safety", () => {
  it("routes 'acceptable daily intake' to efsa_openfoodtox", () => {
    const r = classifyClaim(
      makeClaim("The acceptable daily intake for aspartame is 40 mg/kg.")
    );
    expect(r.domain).toBe("food_safety");
    expect(r.routes[0].sourceId).toBe("efsa_openfoodtox");
  });

  it("routes 'EFSA' to efsa_openfoodtox", () => {
    const r = classifyClaim(
      makeClaim(
        "EFSA assessed the safety of titanium dioxide as a food additive."
      )
    );
    expect(r.domain).toBe("food_safety");
    expect(r.routes[0].sourceId).toBe("efsa_openfoodtox");
  });
});

describe("classifyClaim — chemistry", () => {
  it("routes 'molecular weight' to pubchem", () => {
    const r = classifyClaim(
      makeClaim("The molecular weight of aspirin is 180.16 g/mol.")
    );
    expect(r.domain).toBe("chemistry");
    expect(r.routes[0].sourceId).toBe("pubchem");
  });

  it("routes 'compound' to pubchem", () => {
    const r = classifyClaim(
      makeClaim("The compound has a melting point of 135°C.")
    );
    expect(r.domain).toBe("chemistry");
    expect(r.routes[0].sourceId).toBe("pubchem");
  });
});

describe("classifyClaim — preprint", () => {
  it("routes 'biorxiv' to biorxiv", () => {
    const r = classifyClaim(
      makeClaim("The preprint posted to bioRxiv describes a new CRISPR method.")
    );
    expect(r.domain).toBe("preprint");
    expect(r.routes[0].sourceId).toBe("biorxiv");
  });
});

describe("classifyClaim — financial_regulatory", () => {
  it("routes 'SEC filing' to edgar_sec", () => {
    const r = classifyClaim(
      makeClaim("The 10-K SEC filing shows revenue of $2.4 billion.")
    );
    expect(r.domain).toBe("financial_regulatory");
    expect(r.routes[0].sourceId).toBe("edgar_sec");
  });
});

describe("classifyClaim — legal", () => {
  it("routes 'court ruling' to court_listener", () => {
    const r = classifyClaim(
      makeClaim("The court ruling established a new legal precedent.")
    );
    expect(r.domain).toBe("legal");
    expect(r.routes[0].sourceId).toBe("court_listener");
  });
});

describe("classifyClaim — internet_standards", () => {
  it("routes 'RFC 7231' to ietf_rfc", () => {
    const r = classifyClaim(
      makeClaim("RFC 7231 defines the semantics of HTTP/1.1.")
    );
    expect(r.domain).toBe("internet_standards");
    expect(r.routes[0].sourceId).toBe("ietf_rfc");
  });
});

describe("classifyClaim — cybersecurity_standards", () => {
  it("routes 'NIST' to nist", () => {
    const r = classifyClaim(
      makeClaim("NIST SP 800-53 defines security controls for federal systems.")
    );
    expect(r.domain).toBe("cybersecurity_standards");
    expect(r.routes[0].sourceId).toBe("nist");
  });
});

describe("classifyClaim — economics_macro", () => {
  it("routes 'GDP' to world_bank", () => {
    const r = classifyClaim(makeClaim("Iceland's GDP grew by 4.2% in 2023."));
    expect(r.domain).toBe("economics_macro");
    expect(r.routes[0].sourceId).toBe("world_bank");
  });
});

describe("classifyClaim — public_health", () => {
  it("routes 'pandemic' to who", () => {
    const r = classifyClaim(
      makeClaim("The pandemic caused excess mortality in 2020.")
    );
    expect(r.domain).toBe("public_health");
    expect(r.routes[0].sourceId).toBe("who");
  });
});

describe("classifyClaim — climate", () => {
  it("routes 'climate change' to ipcc", () => {
    const r = classifyClaim(
      makeClaim("Climate change is causing sea level rise.")
    );
    expect(r.domain).toBe("climate");
    expect(r.routes[0].sourceId).toBe("ipcc");
  });

  it("routes 'CO2 emissions' to ipcc", () => {
    const r = classifyClaim(makeClaim("CO2 emissions reached 37 Gt in 2023."));
    expect(r.domain).toBe("climate");
    expect(r.routes[0].sourceId).toBe("ipcc");
  });
});

// ─── classifyClaim: fallback ──────────────────────────────────────────────────

describe("classifyClaim — fallback (unknown domain)", () => {
  it("returns domain=unknown for unrecognized claims", () => {
    const r = classifyClaim(makeClaim("The sky is blue."));
    expect(r.domain).toBe("unknown");
    expect(r.routes.length).toBeGreaterThan(0);
  });

  it("fallback primary source is pubmed", () => {
    const r = classifyClaim(
      makeClaim("Something completely unrelated to any domain.")
    );
    expect(r.routes[0].sourceId).toBe("pubmed");
  });

  it("never throws — always returns at least one route", () => {
    const r = classifyClaim(makeClaim(""));
    expect(r.routes.length).toBeGreaterThan(0);
  });
});

// ─── classifyClaim: result shape ─────────────────────────────────────────────

describe("classifyClaim — result shape", () => {
  it("returns a ClassificationResult with all required fields", () => {
    const r = classifyClaim(
      makeClaim("The protein structure was resolved by X-ray crystallography.")
    );
    expect(r).toHaveProperty("claim");
    expect(r).toHaveProperty("routes");
    expect(r).toHaveProperty("domain");
    expect(r).toHaveProperty("durationMs");
    expect(typeof r.durationMs).toBe("number");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("routes are ordered by confidence (descending)", () => {
    const r = classifyClaim(
      makeClaim("The randomized controlled trial showed efficacy.")
    );
    for (let i = 1; i < r.routes.length; i++) {
      expect(r.routes[i - 1].confidence).toBeGreaterThanOrEqual(
        r.routes[i].confidence
      );
    }
  });

  it("each route has sourceId, confidence, and reason", () => {
    const r = classifyClaim(
      makeClaim("The enzyme has a molecular weight of 50 kDa.")
    );
    for (const route of r.routes) {
      expect(route).toHaveProperty("sourceId");
      expect(route).toHaveProperty("confidence");
      expect(route).toHaveProperty("reason");
      expect(typeof route.confidence).toBe("number");
      expect(route.confidence).toBeGreaterThan(0);
      expect(route.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ─── classifyClaims ───────────────────────────────────────────────────────────

describe("classifyClaims", () => {
  it("returns one result per input claim in order", () => {
    const claims = [
      makeClaim("The protein structure was resolved."),
      makeClaim("The GDP of Iceland grew."),
      makeClaim("Climate change is accelerating."),
    ];
    const results = classifyClaims(claims);
    expect(results).toHaveLength(3);
    expect(results[0].domain).toBe("structural_biology");
    expect(results[1].domain).toBe("economics_macro");
    expect(results[2].domain).toBe("climate");
  });

  it("handles empty array", () => {
    expect(classifyClaims([])).toEqual([]);
  });
});

// ─── getPrimaryRoute ──────────────────────────────────────────────────────────

describe("getPrimaryRoute", () => {
  it("returns the first (highest-confidence) route", () => {
    const r = classifyClaim(makeClaim("The BRCA1 mutation is pathogenic."));
    const primary = getPrimaryRoute(r);
    expect(primary).toBe(r.routes[0]);
    expect(primary.sourceId).toBe("clinvar");
  });
});

// ─── getAllSourceIds ──────────────────────────────────────────────────────────

describe("getAllSourceIds", () => {
  it("returns deduplicated source IDs across multiple results", () => {
    const results = classifyClaims([
      makeClaim("The protein structure was resolved."),
      makeClaim("The enzyme catalase decomposes peroxide."),
    ]);
    const ids = getAllSourceIds(results);
    // Both structural_biology and protein_biochemistry include pubmed
    expect(ids).toContain("pubmed");
    // No duplicates
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("returns empty array for empty input", () => {
    expect(getAllSourceIds([])).toEqual([]);
  });
});
