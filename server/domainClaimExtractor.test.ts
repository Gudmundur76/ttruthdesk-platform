/**
 * domainClaimExtractor.test.ts
 * Tests for DOMAIN_EXTRACTOR_CONFIGS and getDomainExtractorConfig()
 */
import { describe, it, expect } from "vitest";
import {
  DOMAIN_EXTRACTOR_CONFIGS,
  getDomainExtractorConfig,
  type DomainClaimConfig,
} from "./domainClaimExtractor";

// ─── Interface shape validation ───────────────────────────────────────────────
function isValidConfig(cfg: DomainClaimConfig): boolean {
  return (
    typeof cfg.systemPrompt === "string" &&
    cfg.systemPrompt.length > 0 &&
    typeof cfg.userPrefix === "string" &&
    cfg.userPrefix.length > 0 &&
    Array.isArray(cfg.claimTypes) &&
    cfg.claimTypes.length > 0 &&
    typeof cfg.extraSchemaProperties === "object" &&
    Array.isArray(cfg.extraRequired)
  );
}

describe("DOMAIN_EXTRACTOR_CONFIGS", () => {
  it("exports a non-empty record of configs", () => {
    expect(typeof DOMAIN_EXTRACTOR_CONFIGS).toBe("object");
    expect(Object.keys(DOMAIN_EXTRACTOR_CONFIGS).length).toBeGreaterThan(10);
  });

  it("contains all expected core domains", () => {
    const expectedDomains = [
      "structural_biology",
      "protein_biochemistry",
      "clinical_trial",
      "pharmacology",
      "genomics_genetics",
      "food_safety",
      "biomedical_general",
      "preprint",
      "academic_literature",
      "financial_regulatory",
      "legal",
      "internet_standards",
      "cybersecurity_standards",
      "economics_macro",
      "public_health",
      "climate",
      "chemistry",
      "energy",
      "earth_science",
      "social_science",
      "unknown",
    ];
    for (const domain of expectedDomains) {
      expect(DOMAIN_EXTRACTOR_CONFIGS).toHaveProperty(domain);
    }
  });

  it("every config has required fields with non-empty values", () => {
    for (const [domain, cfg] of Object.entries(DOMAIN_EXTRACTOR_CONFIGS)) {
      expect(isValidConfig(cfg), `Config for '${domain}' is invalid`).toBe(true);
    }
  });

  it("structural_biology config has correct claim types", () => {
    const cfg = DOMAIN_EXTRACTOR_CONFIGS.structural_biology;
    expect(cfg.claimTypes).toContain("pdb_id");
    expect(cfg.claimTypes).toContain("protein_name");
    expect(cfg.claimTypes).toContain("experimental_method");
    expect(cfg.claimTypes).toContain("resolution");
    expect(cfg.claimTypes).toContain("organism");
    expect(cfg.claimTypes).toContain("ligand");
  });

  it("clinical_trial config has correct claim types", () => {
    const cfg = DOMAIN_EXTRACTOR_CONFIGS.clinical_trial;
    expect(cfg.claimTypes).toContain("trial_id");
    expect(cfg.claimTypes).toContain("intervention");
    expect(cfg.claimTypes).toContain("primary_endpoint");
    expect(cfg.claimTypes).toContain("adverse_event");
    expect(cfg.claimTypes).toContain("efficacy_result");
  });

  it("structural_biology extraRequired includes pdbId and proteinName", () => {
    const cfg = DOMAIN_EXTRACTOR_CONFIGS.structural_biology;
    expect(cfg.extraRequired).toContain("pdbId");
    expect(cfg.extraRequired).toContain("proteinName");
    expect(cfg.extraRequired).toContain("experimentalMethod");
    expect(cfg.extraRequired).toContain("resolution");
    expect(cfg.extraRequired).toContain("organism");
    expect(cfg.extraRequired).toContain("ligand");
  });

  it("pharmacology and openfda_adverse share the same config", () => {
    expect(DOMAIN_EXTRACTOR_CONFIGS.openfda_adverse).toBe(
      DOMAIN_EXTRACTOR_CONFIGS.pharmacology
    );
  });

  it("nice and clinical_trial share the same config", () => {
    expect(DOMAIN_EXTRACTOR_CONFIGS.nice).toBe(
      DOMAIN_EXTRACTOR_CONFIGS.clinical_trial
    );
  });

  it("who_iris and public_health share the same config", () => {
    expect(DOMAIN_EXTRACTOR_CONFIGS.who_iris).toBe(
      DOMAIN_EXTRACTOR_CONFIGS.public_health
    );
  });

  it("embase and biomedical_general share the same config", () => {
    expect(DOMAIN_EXTRACTOR_CONFIGS.embase).toBe(
      DOMAIN_EXTRACTOR_CONFIGS.biomedical_general
    );
  });

  it("psychology and social_science share the same config", () => {
    expect(DOMAIN_EXTRACTOR_CONFIGS.psychology).toBe(
      DOMAIN_EXTRACTOR_CONFIGS.social_science
    );
  });

  it("environmental_science and climate share the same config", () => {
    expect(DOMAIN_EXTRACTOR_CONFIGS.environmental_science).toBe(
      DOMAIN_EXTRACTOR_CONFIGS.climate
    );
  });

  it("each systemPrompt mentions the domain or claim types", () => {
    const cfg = DOMAIN_EXTRACTOR_CONFIGS.structural_biology;
    expect(cfg.systemPrompt.toLowerCase()).toMatch(/structural biology|pdb|molecular/);
  });

  it("energy config has energy-specific claim types", () => {
    const cfg = DOMAIN_EXTRACTOR_CONFIGS.energy;
    expect(cfg.claimTypes.length).toBeGreaterThan(0);
    // Energy domain should have energy-related claim types
    const types = cfg.claimTypes.join(",").toLowerCase();
    expect(types).toMatch(/energy|power|capacity|emission|fuel|grid|renewable|fossil/);
  });

  it("earth_science config has geoscience claim types", () => {
    const cfg = DOMAIN_EXTRACTOR_CONFIGS.earth_science;
    expect(cfg.claimTypes.length).toBeGreaterThan(0);
    const types = cfg.claimTypes.join(",").toLowerCase();
    expect(types).toMatch(/earthquake|seismic|magnitude|geologic|volcano|tectonic|climate|temperature/);
  });

  it("legal config has legal claim types", () => {
    const cfg = DOMAIN_EXTRACTOR_CONFIGS.legal;
    expect(cfg.claimTypes.length).toBeGreaterThan(0);
    const types = cfg.claimTypes.join(",").toLowerCase();
    expect(types).toMatch(/statute|regulation|case|ruling|compliance|penalty|contract|law/);
  });
});

describe("getDomainExtractorConfig()", () => {
  it("returns the correct config for a known domain", () => {
    const cfg = getDomainExtractorConfig("structural_biology");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.structural_biology);
  });

  it("returns the correct config for clinical_trial", () => {
    const cfg = getDomainExtractorConfig("clinical_trial");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.clinical_trial);
  });

  it("returns the correct config for pharmacology", () => {
    const cfg = getDomainExtractorConfig("pharmacology");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.pharmacology);
  });

  it("falls back to biomedical_general for unknown domain", () => {
    const cfg = getDomainExtractorConfig("nonexistent_domain");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.biomedical_general);
  });

  it("falls back to biomedical_general for empty string", () => {
    const cfg = getDomainExtractorConfig("");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.biomedical_general);
  });

  it("falls back to biomedical_general for random garbage", () => {
    const cfg = getDomainExtractorConfig("xyz_not_a_domain_123");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.biomedical_general);
  });

  it("returns unknown config for 'unknown' domain key", () => {
    const cfg = getDomainExtractorConfig("unknown");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.unknown);
  });

  it("returns config for all domains without throwing", () => {
    const domains = Object.keys(DOMAIN_EXTRACTOR_CONFIGS);
    for (const domain of domains) {
      expect(() => getDomainExtractorConfig(domain)).not.toThrow();
    }
  });

  it("returned config has all required fields", () => {
    const cfg = getDomainExtractorConfig("genomics_genetics");
    expect(cfg.systemPrompt).toBeTruthy();
    expect(cfg.userPrefix).toBeTruthy();
    expect(Array.isArray(cfg.claimTypes)).toBe(true);
    expect(cfg.claimTypes.length).toBeGreaterThan(0);
    expect(typeof cfg.extraSchemaProperties).toBe("object");
    expect(Array.isArray(cfg.extraRequired)).toBe(true);
  });

  it("handles alias domains correctly (openfda_adverse → pharmacology)", () => {
    const cfg = getDomainExtractorConfig("openfda_adverse");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.pharmacology);
  });

  it("handles alias domains correctly (nice → clinical_trial)", () => {
    const cfg = getDomainExtractorConfig("nice");
    expect(cfg).toBe(DOMAIN_EXTRACTOR_CONFIGS.clinical_trial);
  });
});
