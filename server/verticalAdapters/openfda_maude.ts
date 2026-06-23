import { registerVertical, EvidenceResult, VerticalAdapter } from './types';
import { logger, errData } from "../logger";

const log = logger("verticalAdapters/openfda_maude");
const MAUDE_API_BASE = 'https://api.fda.gov/device/event.json';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

/**
 * OpenFDA MAUDE (Manufacturer and User Facility Device Experience) adapter.
 * Covers adverse event reports for medical devices submitted to the FDA.
 * High count of serious adverse events = negative confidence signal for safety claims.
 * Sprint 38 — Tier 1 public database expansion.
 */
const openfdaMaudeAdapter: VerticalAdapter = {
  domainKey: 'openfda_maude',
  displayName: 'OpenFDA MAUDE',
  description: 'FDA MAUDE database — adverse event reports for medical devices including malfunction, injury, and death reports',
  claimExtractorPrompt: 'Extract medical device names, device generic names, brand names, or FDA product codes from the claim text.',
  discoverySearchTerms: ['medical device', 'adverse event', 'device malfunction', 'FDA MAUDE', 'device safety', 'implant', 'diagnostic device'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const query = claim.extractedValue || claim.claimText;
    // Sanitize query for FDA API — remove special chars, keep alphanumeric and spaces
    const sanitized = query.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().slice(0, 100);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12_000);

      // Search by device generic name, limit to 5 results
      const searchUrl = `${MAUDE_API_BASE}?search=device.generic_name:"${encodeURIComponent(sanitized)}"&limit=5&count=event_type.exact`;
      const res = await fetch(searchUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 404) {
          // No results — try broader search without quotes
          const ctrl2 = new AbortController();
          const t2 = setTimeout(() => ctrl2.abort(), 10_000);
          const broadUrl = `${MAUDE_API_BASE}?search=device.generic_name:${encodeURIComponent(sanitized)}&limit=5`;
          const res2 = await fetch(broadUrl, {
            signal: ctrl2.signal,
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
          });
          clearTimeout(t2);
          if (!res2.ok) {
            return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.5, confidenceFlags: ['No MAUDE records found'] };
          }
          const data2 = await res2.json() as { results?: unknown[]; meta?: { results?: { total?: number } } };
          if (!data2.results || data2.results.length === 0) {
            return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.5, confidenceFlags: ['No MAUDE records found'] };
          }
          return buildResult(sanitized, data2, []);
        }
        return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.5, confidenceFlags: [`HTTP ${res.status}`] };
      }

      // Count endpoint returns event_type distribution
      const countData = await res.json() as { results?: Array<{ term: string; count: number }>; meta?: { results?: { total?: number } } };
      const eventTypeCounts = countData.results ?? [];
      const total = countData.meta?.results?.total ?? 0;

      if (total === 0 || eventTypeCounts.length === 0) {
        return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.6, confidenceFlags: ['No MAUDE adverse events found'] };
      }

      return buildResult(sanitized, countData as Record<string, unknown>, eventTypeCounts);

    } catch (error: unknown) {
      log.error(`Error looking up OpenFDA MAUDE for '${query}':`, errData(error));
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.5, confidenceFlags: [`Error: ${(error as Error).message}`] };
    }
  }
};

function buildResult(
  deviceName: string,
  rawData: Record<string, unknown>,
  eventTypeCounts: Array<{ term: string; count: number }>
): EvidenceResult {
  const meta = (rawData as { meta?: { results?: { total?: number } } }).meta;
  const total = meta?.results?.total ?? 0;

  const deathCount = eventTypeCounts.find(e => e.term === 'Death')?.count ?? 0;
  const injuryCount = eventTypeCounts.find(e => e.term === 'Injury')?.count ?? 0;
  const malfunctionCount = eventTypeCounts.find(e => e.term === 'Malfunction')?.count ?? 0;

  const confidenceFlags: string[] = [`${total} total adverse event reports`];
  if (deathCount > 0) confidenceFlags.push(`${deathCount} death reports`);
  if (injuryCount > 0) confidenceFlags.push(`${injuryCount} injury reports`);
  if (malfunctionCount > 0) confidenceFlags.push(`${malfunctionCount} malfunction reports`);

  // Confidence scoring: high adverse event rate = lower confidence for safety claims
  let confidenceScore = 0.70;
  const seriousRatio = total > 0 ? (deathCount + injuryCount) / total : 0;

  if (deathCount > 100 || seriousRatio > 0.3) {
    confidenceScore = 0.30;
    confidenceFlags.push('HIGH adverse event signal');
  } else if (deathCount > 10 || seriousRatio > 0.1) {
    confidenceScore = 0.50;
    confidenceFlags.push('Moderate adverse event signal');
  } else if (total > 1000) {
    confidenceScore = 0.60;
    confidenceFlags.push('Large adverse event database');
  }

  const searchUrl = `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/search.cfm?start_search=1&devicename=${encodeURIComponent(deviceName)}`;

  return {
    found: true,
    sourceId: `MAUDE:${deviceName.replace(/\s+/g, '_').toUpperCase()}`,
    sourceUrl: searchUrl,
    evidenceRaw: rawData,
    confidenceScore,
    confidenceFlags
  };
}

registerVertical(openfdaMaudeAdapter);
