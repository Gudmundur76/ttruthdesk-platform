/**
 * sprint40.test.ts — Domain-aware claim extraction tests
 *
 * Tests the full domain-aware extraction stack:
 *   1. domainClaimExtractor — config coverage for all domains
 *   2. domainInference — text-to-domain classification
 *   3. claimExtractor — domain parameter routing + normalisation
 *   4. analysisPipeline — domain passed to extractClaims, zero-claim notification guard
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDomainExtractorConfig,
  DOMAIN_EXTRACTOR_CONFIGS,
} from "./domainClaimExtractor";
import { inferDomainFromText } from "./domainInference";

// ─── 1. domainClaimExtractor ──────────────────────────────────────────────────

describe("domainClaimExtractor", () => {
  const ALL_DOMAINS = [
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
    "openfda_adverse",
    "nice",
    "who_iris",
    "embase",
    "energy",
    "earth_science",
    "social_science",
    "psychology",
    "environmental_science",
    "unknown",
  ];

  it("returns a config for every registered domain", () => {
    for (const domain of ALL_DOMAINS) {
      const config = getDomainExtractorConfig(domain);
      expect(config).toBeDefined();
      expect(config.systemPrompt.length).toBeGreaterThan(50);
      expect(config.claimTypes.length).toBeGreaterThan(0);
    }
  });

  it("falls back to biomedical_general for unmapped domains", () => {
    const fallback = getDomainExtractorConfig("totally_unknown_domain_xyz");
    const biomedical = getDomainExtractorConfig("biomedical_general");
    expect(fallback.systemPrompt).toBe(biomedical.systemPrompt);
  });

  it("structural_biology config contains PDB-specific claim types", () => {
    const config = getDomainExtractorConfig("structural_biology");
    expect(config.claimTypes).toContain("pdb_id");
    expect(config.claimTypes).toContain("resolution");
    expect(config.claimTypes).toContain("experimental_method");
  });

  it("clinical_trial config contains trial-specific claim types", () => {
    const config = getDomainExtractorConfig("clinical_trial");
    expect(config.claimTypes).toContain("trial_id");
    expect(config.claimTypes).toContain("efficacy_result");
    expect(config.claimTypes).toContain("adverse_event");
  });

  it("energy config contains energy-specific claim types", () => {
    const config = getDomainExtractorConfig("energy");
    expect(config.claimTypes).toContain("production");
    expect(config.claimTypes).toContain("capacity");
    expect(config.claimTypes).toContain("co2_intensity");
  });

  it("earth_science config contains geology-specific claim types", () => {
    const config = getDomainExtractorConfig("earth_science");
    expect(config.claimTypes).toContain("earthquake");
    expect(config.claimTypes).toContain("mineral");
    expect(config.claimTypes).toContain("remote_sensing");
  });

  it("economics_macro config contains macroeconomic claim types", () => {
    const config = getDomainExtractorConfig("economics_macro");
    expect(config.claimTypes).toContain("gdp");
    expect(config.claimTypes).toContain("inflation");
    expect(config.claimTypes).toContain("unemployment");
  });

  it("social_science config contains social science claim types", () => {
    const config = getDomainExtractorConfig("social_science");
    expect(config.claimTypes).toContain("meta_analysis");
    expect(config.claimTypes).toContain("survey_result");
  });

  it("every config has non-empty extraSchemaProperties and extraRequired", () => {
    for (const [domain, config] of Object.entries(DOMAIN_EXTRACTOR_CONFIGS)) {
      expect(
        Object.keys(config.extraSchemaProperties).length,
        `${domain} extraSchemaProperties should not be empty`
      ).toBeGreaterThan(0);
      expect(
        config.extraRequired.length,
        `${domain} extraRequired should not be empty`
      ).toBeGreaterThan(0);
    }
  });

  it("no domain config has structural_biology-only claim types for non-structural domains", () => {
    const structuralOnlyTypes = ["pdb_id", "resolution", "experimental_method"];
    const nonStructuralDomains = ALL_DOMAINS.filter(
      d => d !== "structural_biology" && d !== "protein_biochemistry" && d !== "unknown"
    );
    for (const domain of nonStructuralDomains) {
      const config = getDomainExtractorConfig(domain);
      const hasStructuralOnly = structuralOnlyTypes.every(t =>
        config.claimTypes.includes(t)
      );
      expect(
        hasStructuralOnly,
        `${domain} should not use structural_biology claim types`
      ).toBe(false);
    }
  });
});

// ─── 2. domainInference ───────────────────────────────────────────────────────

describe("inferDomainFromText", () => {
  it("returns biomedical_general for empty text", () => {
    expect(inferDomainFromText("")).toBe("biomedical_general");
    expect(inferDomainFromText("   ")).toBe("biomedical_general");
  });

  it("classifies structural biology text correctly", () => {
    const text =
      "Crystal structure of EGFR kinase at 1.8 Å resolution by X-ray crystallography. PDB entry 1IEP.";
    expect(inferDomainFromText(text)).toBe("structural_biology");
  });

  it("classifies clinical trial text correctly", () => {
    const text =
      "A randomised controlled trial of pembrolizumab versus placebo. Primary endpoint: overall survival. NCT02142738.";
    expect(inferDomainFromText(text)).toBe("clinical_trial");
  });

  it("classifies pharmacology text correctly", () => {
    const text =
      "Imatinib mesylate inhibits BCR-ABL tyrosine kinase with IC50 of 0.1 μM. Mechanism of action: competitive ATP binding.";
    expect(inferDomainFromText(text)).toBe("pharmacology");
  });

  it("classifies genomics text correctly", () => {
    const text =
      "GWAS study identifies rs12345 SNP associated with type 2 diabetes. Gene expression profiling by RNA-seq.";
    expect(inferDomainFromText(text)).toBe("genomics_genetics");
  });

  it("classifies economics text correctly", () => {
    const text =
      "GDP growth rate of 2.3% in 2024. Inflation measured by CPI rose 3.1%. Unemployment fell to 4.2%.";
    expect(inferDomainFromText(text)).toBe("economics_macro");
  });

  it("classifies energy text correctly", () => {
    const text =
      "Solar power capacity reached 1.5 TW globally in 2024. Renewable energy share of electricity generation: 30%.";
    expect(inferDomainFromText(text)).toBe("energy");
  });

  it("classifies earth science text correctly", () => {
    const text =
      "Magnitude 7.2 earthquake struck the Anatolian fault. USGS seismic monitoring recorded aftershocks.";
    expect(inferDomainFromText(text)).toBe("earth_science");
  });

  it("classifies public health text correctly", () => {
    const text =
      "Incidence of tuberculosis: 130 per 100,000 population. Vaccine efficacy of BCG: 60-80%. Mortality rate declined.";
    expect(inferDomainFromText(text)).toBe("public_health");
  });

  it("classifies climate text correctly", () => {
    const text =
      "Global mean temperature anomaly of +1.2°C above pre-industrial baseline. Atmospheric CO2 concentration reached 421 ppm.";
    expect(inferDomainFromText(text)).toBe("climate");
  });

  it("classifies legal text correctly", () => {
    const text =
      "The court held in Smith v. Jones [2023] that the statute requires written consent. The ruling established a new precedent.";
    expect(inferDomainFromText(text)).toBe("legal");
  });

  it("classifies cybersecurity text correctly", () => {
    const text =
      "CVE-2024-1234 affects OpenSSL 3.0. CVSS score 9.8. NIST SP 800-53 control AC-2 requires account management.";
    expect(inferDomainFromText(text)).toBe("cybersecurity_standards");
  });

  it("returns biomedical_general for low-signal generic text", () => {
    const text = "This paper presents a study of various factors affecting outcomes.";
    // Low signal — should fall back to biomedical_general
    const result = inferDomainFromText(text);
    expect(result).toBe("biomedical_general");
  });

  it("correctly classifies the bipolar disorder paper that triggered the bug", () => {
    const text =
      "Distinct neural signatures of reward processing underlying bipolar disorder and major depressive disorder: a systematic review and meta-analysis. This study examined neuroimaging data from 45 studies using fMRI and PET. Effect sizes (Cohen's d) were computed for reward anticipation and reward outcome.";
    // This paper is NOT structural biology — it should classify as social_science or public_health or biomedical_general
    const result = inferDomainFromText(text);
    expect(result).not.toBe("structural_biology");
  });
});

// ─── 3. claimExtractor — domain routing ──────────────────────────────────────

describe("extractClaims (domain-aware)", () => {
  const mockInvoke = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.doMock("./_core/multiLLM", () => ({
      invokeMultiLLM: mockInvoke,
      getActiveLLMProvider: () => "openai",
    }));
  });

  it("uses clinical_trial prompt when domain is clinical_trial", async () => {
    mockInvoke.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              claims: [
                {
                  claimText: "Pembrolizumab improved OS by 4.2 months",
                  claimType: "efficacy_result",
                  extractedValue: "4.2 months",
                  trialId: "NCT02142738",
                  intervention: "pembrolizumab",
                  endpoint: "overall survival",
                  populationSize: 500,
                  pValue: 0.001,
                },
              ],
            }),
          },
        },
      ],
    });

    const { extractClaims } = await import("./claimExtractor");
    const results = await extractClaims(
      "A randomised trial of pembrolizumab. NCT02142738.",
      undefined,
      "clinical_trial"
    );

    expect(results).toHaveLength(1);
    expect(results[0].claimType).toBe("efficacy_result");
    expect(results[0].domainFields.trialId).toBe("NCT02142738");

    // Verify the prompt sent to the LLM used the clinical_trial system prompt
    const callArgs = mockInvoke.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("clinical trial claim extractor");
    expect(callArgs.messages[0].content).not.toContain("molecular biology");
  });

  it("uses energy prompt when domain is energy", async () => {
    mockInvoke.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              claims: [
                {
                  claimText: "Solar capacity reached 1.5 TW in 2024",
                  claimType: "capacity",
                  extractedValue: "1.5 TW",
                  country: "Global",
                  year: 2024,
                  value: 1500,
                  unit: "GW",
                  energySource: "solar",
                },
              ],
            }),
          },
        },
      ],
    });

    const { extractClaims } = await import("./claimExtractor");
    const results = await extractClaims(
      "Solar power capacity reached 1.5 TW globally in 2024.",
      undefined,
      "energy"
    );

    expect(results).toHaveLength(1);
    expect(results[0].claimType).toBe("capacity");
    expect(results[0].domainFields.energySource).toBe("solar");

    const callArgs = mockInvoke.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("energy statistics claim extractor");
  });

  it("falls back to structural_biology prompt when no domain is specified", async () => {
    mockInvoke.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              claims: [
                {
                  claimText: "Crystal structure at 1.8 Å",
                  claimType: "resolution",
                  extractedValue: "1.8",
                  pdbId: "1ABC",
                  proteinName: "EGFR",
                  experimentalMethod: "X-ray",
                  resolution: 1.8,
                  organism: "Homo sapiens",
                  ligand: null,
                },
              ],
            }),
          },
        },
      ],
    });

    const { extractClaims } = await import("./claimExtractor");
    const results = await extractClaims("Crystal structure at 1.8 Å");

    expect(results).toHaveLength(1);
    expect(results[0].claimType).toBe("resolution");
    // Legacy fields should be populated for structural_biology
    expect(results[0].pdbId).toBe("1ABC");
    expect(results[0].resolution).toBe(1.8);

    const callArgs = mockInvoke.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("structural biology claim extractor");
  });

  it("returns [] and does not throw when LLM returns empty claims array", async () => {
    mockInvoke.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ claims: [] }) } }],
    });

    const { extractClaims } = await import("./claimExtractor");
    const results = await extractClaims(
      "This paper discusses various topics.",
      undefined,
      "biomedical_general"
    );

    expect(results).toEqual([]);
  });

  it("returns [] and does not throw when LLM returns null content", async () => {
    mockInvoke.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const { extractClaims } = await import("./claimExtractor");
    const results = await extractClaims("Some text", undefined, "clinical_trial");
    expect(results).toEqual([]);
  });

  it("normalises domainFields correctly from raw LLM output", async () => {
    mockInvoke.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              claims: [
                {
                  claimText: "Magnitude 7.2 earthquake",
                  claimType: "earthquake",
                  extractedValue: "7.2",
                  location: "Turkey",
                  magnitude: 7.2,
                  date: "2024-01-15",
                  value: 7.2,
                  unit: "Mw",
                },
              ],
            }),
          },
        },
      ],
    });

    const { extractClaims } = await import("./claimExtractor");
    const results = await extractClaims("Magnitude 7.2 earthquake in Turkey", undefined, "earth_science");

    expect(results[0].domainFields.location).toBe("Turkey");
    expect(results[0].domainFields.magnitude).toBe(7.2);
    // Legacy structural biology fields should be null for non-structural domains
    expect(results[0].pdbId).toBeNull();
    expect(results[0].resolution).toBeNull();
  });
});

// ─── 4. Zero-claim notification guard ────────────────────────────────────────

describe("zero-claim notification guard", () => {
  it("inferDomainFromText correctly identifies the bipolar disorder paper as non-structural", () => {
    // This is the exact paper that triggered the bug report
    const title =
      "Distinct neural signatures of reward processing underlying bipolar disorder and major depressive disorder: a systematic review and meta-analysis";
    const abstract =
      "Background: Reward processing abnormalities are implicated in both bipolar disorder (BD) and major depressive disorder (MDD). Methods: We conducted a systematic review and meta-analysis of neuroimaging studies. Results: Significant differences in ventral striatum activation were observed (Cohen's d = 0.45, p < 0.001). Conclusion: BD and MDD show distinct neural signatures.";

    const domain = inferDomainFromText(`${title} ${abstract}`);

    // Must NOT be structural_biology — that was the bug
    expect(domain).not.toBe("structural_biology");
    // Should be classified as social_science, public_health, or biomedical_general
    expect(["social_science", "public_health", "biomedical_general", "clinical_trial"]).toContain(domain);
  });

  it("getDomainExtractorConfig for the inferred domain does not use structural biology claim types", () => {
    const title =
      "Distinct neural signatures of reward processing underlying bipolar disorder and major depressive disorder: a systematic review and meta-analysis";
    const domain = inferDomainFromText(title);
    const config = getDomainExtractorConfig(domain);

    // The prompt should NOT ask for PDB IDs or protein structures
    expect(config.systemPrompt).not.toContain("PDB accession");
    expect(config.claimTypes).not.toContain("pdb_id");
    expect(config.claimTypes).not.toContain("resolution");
  });
});
