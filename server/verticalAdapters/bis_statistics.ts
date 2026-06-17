/**
 * bis_statistics.ts — Sprint 33
 *
 * Bank for International Settlements (BIS) Statistics adapter.
 * Queries the BIS public SDMX dataflows API to discover relevant
 * statistical datasets for macroprudential, banking, and financial
 * stability claims.
 *
 * API: https://stats.bis.org/api/v1/dataflow/BIS
 * Docs: https://www.bis.org/statistics/sdmx_api.htm
 */

import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/bis_statistics");

interface BisDataflow {
  id: string;
  name: Array<{ value: string }>;
}

interface BisDataflowResponse {
  data?: {
    dataflows?: BisDataflow[];
  };
}

const BIS_API_BASE = "https://stats.bis.org/api/v1";

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

/** Find the best matching dataflow for the query */
function matchDataflow(
  dataflows: BisDataflow[],
  query: string
): { flow: BisDataflow; matched: boolean } | null {
  if (!dataflows.length) return null;

  const q = query.toLowerCase();
  const queryWords = q.split(/\s+/).filter((w) => w.length > 3);

  // Try to find a keyword match
  for (const flow of dataflows) {
    const name = (flow.name[0]?.value ?? "").toLowerCase();
    if (queryWords.some((word) => name.includes(word))) {
      return { flow, matched: true };
    }
  }

  // Fallback: return first dataflow without keyword match
  return { flow: dataflows[0], matched: false };
}

class BisStatisticsAdapter implements VerticalAdapter {
  readonly domainKey = "bis_statistics";
  readonly displayName = "BIS Statistics";
  readonly description =
    "Bank for International Settlements — macroprudential, banking, and financial stability statistics. Authoritative global data on credit gaps, debt service ratios, property prices, and central bank policy rates.";
  readonly claimExtractorPrompt =
    "Extract financial stability indicators, credit metrics, or central bank policy terms from the claim (e.g., 'credit-to-GDP gap', 'debt service ratio', 'property price index', 'central bank rate').";
  readonly discoverySearchTerms = [
    "credit gap",
    "debt service ratio",
    "financial stability",
    "central bank rate",
    "BIS statistics",
    "macroprudential",
    "property price index",
    "exchange rate",
    "banking statistics",
    "international settlements",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    log.info("BIS Statistics query", { query });

    try {
      const url = `${BIS_API_BASE}/dataflow/BIS?format=json`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return noResult([`http_error_${res.status}`]);
      }

      const data = (await res.json()) as BisDataflowResponse;
      const dataflows = data?.data?.dataflows ?? [];

      if (!dataflows.length) {
        return noResult(["no_bis_results"]);
      }

      const match = matchDataflow(dataflows, query);
      if (!match) {
        return noResult(["no_bis_results"]);
      }

      const { flow, matched } = match;
      const datasetCode = flow.id;
      const datasetName = flow.name[0]?.value ?? datasetCode;
      const flags = ["bis_official_statistics", "central_bank_data"];
      if (matched) flags.push("keyword_match");

      log.info("BIS Statistics result", { datasetCode, datasetName, matched });

      return {
        found: true,
        sourceId: `bis-${datasetCode.toLowerCase()}`,
        sourceUrl: `https://stats.bis.org/statx/srs/table/${datasetCode}`,
        evidenceRaw: {
          datasetCode,
          datasetName,
          query,
          totalDataflows: dataflows.length,
          keywordMatch: matched,
        },
        confidenceScore: matched ? 0.84 : 0.72,
        confidenceFlags: flags,
      };
    } catch (err) {
      log.error("BIS Statistics fetch error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }
}

registerVertical(new BisStatisticsAdapter());
