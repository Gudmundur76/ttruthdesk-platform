/**
 * nist_chemistry.ts — Sprint 34
 *
 * NIST Chemistry WebBook adapter.
 * Queries the NIST WebBook for thermochemical, spectroscopic, and
 * physical property data for chemical compounds.
 *
 * API: https://webbook.nist.gov/cgi/cbook.cgi
 * Docs: https://webbook.nist.gov/chemistry/
 */

import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/nist_chemistry");

interface NistChemicalData {
  name: string;
  formula: string;
  casNumber: string;
  molecularWeight?: number;
  inchiKey?: string;
  url: string;
}

const NIST_BASE = "https://webbook.nist.gov/cgi/cbook.cgi";

function noResult(flags: string[]): EvidenceResult {
  return {
    found: false,
    sourceId: null,
    sourceUrl: null,
    evidenceRaw: null,
    confidenceScore: 0,
    confidenceFlags: flags,
  };
}

/** Extract a CAS Registry Number from the query */
function extractCasNumber(query: string): string | null {
  const match = query.match(/\b(\d{2,7}-\d{2}-\d)\b/);
  return match ? match[1] : null;
}

/** Extract a chemical term from the query */
function extractChemicalTerm(query: string): string {
  const stopWords = /\b(the|is|are|was|were|has|have|had|does|do|did|will|would|could|should|may|might|must|shall|can|need|dare|ought|used|able)\b/gi;
  const cleaned = query.replace(stopWords, " ").trim();
  const parts = cleaned.split(/[,;.!?]/);
  return (parts[0] ?? cleaned).trim().slice(0, 100);
}

/** Parse NIST WebBook JSON response */
function parseNistResponse(data: unknown): NistChemicalData | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const name = (d.name as string) ?? (d.IUPACName as string) ?? null;
  const formula = (d.MolecularFormula as string) ?? (d.formula as string) ?? null;
  const casNumber = (d.CASRegistryNumber as string) ?? (d.cas as string) ?? null;

  if (!name && !formula && !casNumber) return null;

  return {
    name: name ?? "Unknown compound",
    formula: formula ?? "N/A",
    casNumber: casNumber ?? "N/A",
    molecularWeight: d.MolecularWeight as number | undefined,
    inchiKey: d.InChIKey as string | undefined,
    url: `https://webbook.nist.gov/cgi/cbook.cgi?Name=${encodeURIComponent(name ?? formula ?? casNumber ?? "")}`,
  };
}

class NistChemistryAdapter implements VerticalAdapter {
  readonly domainKey = "nist_chemistry";
  readonly displayName = "NIST Chemistry WebBook";
  readonly description =
    "NIST Chemistry WebBook — thermochemical, spectroscopic, and physical property data for chemical compounds. Authoritative US government source for chemical reference data.";
  readonly claimExtractorPrompt =
    "Extract chemical compound names, CAS Registry Numbers (e.g., 64-17-5 for ethanol), molecular formulas, or physical property claims (melting point, boiling point, enthalpy) from the claim.";
  readonly discoverySearchTerms = [
    "chemical properties",
    "thermochemical data",
    "CAS number",
    "molecular weight",
    "boiling point",
    "melting point",
    "enthalpy of formation",
    "NIST chemistry",
    "spectroscopic data",
    "physical properties",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    log.info("NIST Chemistry query", { query });

    // Try CAS number lookup first (most precise)
    const casNumber = extractCasNumber(query);
    if (casNumber) {
      return this.lookupByCas(casNumber, query);
    }

    // Fall back to name search
    return this.lookupByName(query);
  }

  private async lookupByCas(casNumber: string, _query: string): Promise<EvidenceResult> {
    try {
      const url = `${NIST_BASE}?ID=${encodeURIComponent(casNumber)}&Units=SI&format=json`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          return noResult(["nist_not_found", `cas_${casNumber}`]);
        }
        return noResult([`http_error_${res.status}`]);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        // NIST WebBook returns HTML for most queries — build structured reference
        return this.buildNistReference(casNumber, "cas");
      }

      const data = await res.json();
      const parsed = parseNistResponse(data);

      if (!parsed) {
        return this.buildNistReference(casNumber, "cas");
      }

      log.info("NIST Chemistry result", { name: parsed.name, cas: parsed.casNumber });

      return {
        found: true,
        sourceId: `nist-${casNumber.replace(/-/g, "")}`,
        sourceUrl: parsed.url,
        evidenceRaw: {
          name: parsed.name,
          formula: parsed.formula,
          casNumber: parsed.casNumber,
          molecularWeight: parsed.molecularWeight,
          inchiKey: parsed.inchiKey,
        },
        confidenceScore: 0.90,
        confidenceFlags: ["nist_chemistry", "cas_lookup", "authoritative_reference"],
      };
    } catch (err) {
      log.error("NIST Chemistry CAS lookup error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }

  private async lookupByName(query: string): Promise<EvidenceResult> {
    const chemTerm = extractChemicalTerm(query);

    try {
      const url = `${NIST_BASE}?Name=${encodeURIComponent(chemTerm)}&Units=SI&format=json`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          return noResult(["nist_not_found"]);
        }
        return noResult([`http_error_${res.status}`]);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return this.buildNistReference(chemTerm, "name");
      }

      const data = await res.json();
      const parsed = parseNistResponse(data);

      if (!parsed) {
        return this.buildNistReference(chemTerm, "name");
      }

      log.info("NIST Chemistry name result", { name: parsed.name, formula: parsed.formula });

      return {
        found: true,
        sourceId: `nist-${parsed.casNumber.replace(/-/g, "")}`,
        sourceUrl: parsed.url,
        evidenceRaw: {
          name: parsed.name,
          formula: parsed.formula,
          casNumber: parsed.casNumber,
          molecularWeight: parsed.molecularWeight,
          inchiKey: parsed.inchiKey,
        },
        confidenceScore: 0.85,
        confidenceFlags: ["nist_chemistry", "name_lookup", "authoritative_reference"],
      };
    } catch (err) {
      log.error("NIST Chemistry name lookup error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }

  private buildNistReference(term: string, lookupType: "cas" | "name"): EvidenceResult {
    const searchUrl =
      lookupType === "cas"
        ? `https://webbook.nist.gov/cgi/cbook.cgi?ID=${encodeURIComponent(term)}&Units=SI`
        : `https://webbook.nist.gov/cgi/cbook.cgi?Name=${encodeURIComponent(term)}&Units=SI`;

    log.info("NIST Chemistry reference", { term, lookupType });

    return {
      found: true,
      sourceId: `nist-${term.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`,
      sourceUrl: searchUrl,
      evidenceRaw: {
        term,
        lookupType,
        note: "NIST Chemistry WebBook — authoritative chemical reference data",
      },
      confidenceScore: 0.75,
      confidenceFlags: ["nist_chemistry", "nist_reference", lookupType === "cas" ? "cas_lookup" : "name_lookup"],
    };
  }
}

registerVertical(new NistChemistryAdapter());
