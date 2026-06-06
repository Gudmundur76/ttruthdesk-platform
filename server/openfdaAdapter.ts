/**
 * openfdaAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenFDA API helper for supplement safety signal lookup.
 * Queries the FDA Adverse Event Reporting System (FAERS) via openFDA.
 * No API key required for ≤240 requests/minute.
 *
 * API docs: https://open.fda.gov/apis/drug/event/
 */

const OPENFDA_EVENTS_API = "https://api.fda.gov/drug/event.json";

export interface FdaAdverseEventResult {
  found: boolean;
  totalEvents: number;
  seriousEvents: number;
  topReactions: string[];
  sourceUrl: string;
  error: string | null;
}

/**
 * Search the FDA FAERS database for adverse events related to a supplement compound.
 * Returns event counts and top reactions.
 */
export async function searchFdaAdverseEvents(
  compoundName: string
): Promise<FdaAdverseEventResult> {
  const encoded = encodeURIComponent(
    `patient.drug.openfda.brand_name:"${compoundName}" OR patient.drug.openfda.generic_name:"${compoundName}"`
  );
  const url = `${OPENFDA_EVENTS_API}?search=${encoded}&count=patient.reaction.reactionmeddrapt.exact&limit=5`;
  const totalUrl = `${OPENFDA_EVENTS_API}?search=${encoded}&limit=1`;

  try {
    const [countRes, totalRes] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(10_000) }),
      fetch(totalUrl, { signal: AbortSignal.timeout(10_000) }),
    ]);

    let topReactions: string[] = [];
    if (countRes.ok) {
      const countData = await countRes.json() as { results?: Array<{ term: string; count: number }> };
      topReactions = (countData.results ?? []).slice(0, 5).map((r) => r.term);
    }

    let totalEvents = 0;
    let seriousEvents = 0;
    if (totalRes.ok) {
      const totalData = await totalRes.json() as { meta?: { results?: { total?: number } } };
      totalEvents = totalData.meta?.results?.total ?? 0;
    }

    // Estimate serious events (roughly 60% of FAERS reports are serious)
    seriousEvents = Math.round(totalEvents * 0.6);

    const sourceUrl = `https://www.fda.gov/safety/medwatch-fda-safety-information-and-adverse-event-reporting-program`;

    return {
      found: totalEvents > 0,
      totalEvents,
      seriousEvents,
      topReactions,
      sourceUrl,
      error: null,
    };
  } catch (err) {
    return {
      found: false,
      totalEvents: 0,
      seriousEvents: 0,
      topReactions: [],
      sourceUrl: "",
      error: String(err),
    };
  }
}

/**
 * Interpret FDA adverse event data as confidence flags.
 * High event counts are a safety signal that should lower confidence in safety claims.
 */
export function interpretFdaSignals(
  result: FdaAdverseEventResult,
  isSafetyClaim: boolean
): { confidenceDelta: number; flags: string[] } {
  const flags: string[] = [];
  let delta = 0;

  if (!result.found) {
    flags.push("No FDA adverse event reports found — limited safety signal data");
    return { confidenceDelta: 0, flags };
  }

  flags.push(`FDA FAERS: ${result.totalEvents.toLocaleString()} adverse event reports`);

  if (result.topReactions.length > 0) {
    flags.push(`Top reactions: ${result.topReactions.slice(0, 3).join(", ")}`);
  }

  // If the claim is about safety, high event counts lower confidence
  if (isSafetyClaim) {
    if (result.totalEvents > 10_000) {
      delta = -0.20;
      flags.push("High adverse event volume — safety claim requires careful interpretation");
    } else if (result.totalEvents > 1_000) {
      delta = -0.10;
      flags.push("Moderate adverse event volume — review safety claim context");
    } else {
      delta = 0.05;
      flags.push("Low adverse event volume — safety profile appears acceptable");
    }
  }

  return { confidenceDelta: delta, flags };
}
