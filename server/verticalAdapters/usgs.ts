/**
 * usgs.ts — Sprint 37
 *
 * US Geological Survey (USGS) adapter.
 * Queries the USGS National Map and Earthquake Hazards APIs for
 * geologic, seismic, and earth science data.
 *
 * APIs:
 *   - Earthquake: https://earthquake.usgs.gov/fdsnws/event/1/
 *   - Minerals: https://mrdata.usgs.gov/
 * Docs: https://earthquake.usgs.gov/fdsnws/event/1/
 */
import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/usgs");

const USGS_EARTHQUAKE_API = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const USER_AGENT = "citation-engine/1.0 (contact@citation.is)";

/** Keywords that indicate earthquake/seismic queries */
const SEISMIC_TERMS = [
  "earthquake",
  "seismic",
  "magnitude",
  "richter",
  "tremor",
  "fault",
  "tectonic",
  "aftershock",
  "epicenter",
  "seismicity",
];

/** Keywords that indicate mineral/geology queries */
const GEOLOGY_TERMS = [
  "mineral",
  "geology",
  "geological",
  "rock formation",
  "lithium",
  "rare earth",
  "copper deposit",
  "gold deposit",
  "volcanic",
  "groundwater",
];

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

function detectQueryType(text: string): "earthquake" | "geology" | null {
  const lower = text.toLowerCase();
  if (SEISMIC_TERMS.some((t) => lower.includes(t))) return "earthquake";
  if (GEOLOGY_TERMS.some((t) => lower.includes(t))) return "geology";
  return null;
}

/** Extract a magnitude value from text like "magnitude 7.2" or "M6.5" */
function extractMagnitude(text: string): number | null {
  const match = text.match(/(?:magnitude|M)\s*(\d+(?:\.\d+)?)/i);
  return match ? parseFloat(match[1]) : null;
}

class UsgsAdapter implements VerticalAdapter {
  readonly domainKey = "usgs";
  readonly displayName = "USGS Earth Sciences";
  readonly description =
    "US Geological Survey data on earthquakes, seismic hazards, mineral resources, and earth science observations.";
  readonly claimExtractorPrompt =
    "Extract earth science terms (earthquake magnitude, seismic activity, mineral deposits, geological formations) and location names from the claim.";
  readonly discoverySearchTerms = [
    "earthquake magnitude",
    "seismic activity",
    "tectonic plates",
    "mineral resources",
    "geological survey",
    "fault line",
    "volcanic activity",
    "groundwater",
    "lithium deposits",
    "rare earth minerals",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    log.info("USGS query", { query });

    const queryType = detectQueryType(query);
    if (!queryType) {
      return noResult(["no_earth_science_topic_detected"]);
    }

    if (queryType === "earthquake") {
      return this.lookupEarthquake(query);
    }

    // For geology queries, return a reference to USGS mineral resources
    return this.lookupGeology(query);
  }

  private async lookupEarthquake(query: string): Promise<EvidenceResult> {
    const minMagnitude = extractMagnitude(query) ?? 6.0;
    // Query for significant recent earthquakes matching the magnitude
    const url = `${USGS_EARTHQUAKE_API}?format=geojson&minmagnitude=${minMagnitude}&orderby=magnitude&limit=1&starttime=2000-01-01`;

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return noResult([`http_error_${res.status}`]);
      }

      const data = (await res.json()) as {
        features?: Array<{
          id: string;
          properties: {
            mag: number;
            place: string;
            time: number;
            url: string;
            title: string;
          };
        }>;
        metadata?: { count: number };
      };

      if (!data.features || data.features.length === 0) {
        return noResult(["no_usgs_earthquake_data"]);
      }

      const event = data.features[0];
      const props = event.properties;
      log.info("USGS earthquake result", { mag: props.mag, place: props.place });

      return {
        found: true,
        sourceId: `usgs-eq-${event.id}`,
        sourceUrl: props.url ?? `https://earthquake.usgs.gov/earthquakes/eventpage/${event.id}`,
        evidenceRaw: {
          magnitude: props.mag,
          place: props.place,
          time: new Date(props.time).toISOString(),
          title: props.title,
          eventId: event.id,
        },
        confidenceScore: 0.92,
        confidenceFlags: ["usgs_official_data", "earthquake_catalog", "seismic"],
      };
    } catch (err) {
      log.error("USGS earthquake fetch error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }

  private async lookupGeology(query: string): Promise<EvidenceResult> {
    // USGS Mineral Resources Data System — return a reference link
    const encodedQuery = encodeURIComponent(query.slice(0, 100));

    try {
      // Lightweight HEAD check to verify USGS is reachable
      const res = await fetch("https://mrdata.usgs.gov/", {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        return noResult([`http_error_${res.status}`]);
      }

      log.info("USGS geology reference", { query: encodedQuery });

      return {
        found: true,
        sourceId: `usgs-minerals-${encodedQuery.slice(0, 40)}`,
        sourceUrl: `https://mrdata.usgs.gov/geochem/doc/home.htm`,
        evidenceRaw: {
          query,
          dataset: "USGS Mineral Resources Data System",
          note: "Reference to USGS mineral and geological data",
        },
        confidenceScore: 0.72,
        confidenceFlags: ["usgs_official_data", "mineral_resources", "geology"],
      };
    } catch (err) {
      log.error("USGS geology fetch error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }
}

registerVertical(new UsgsAdapter());
