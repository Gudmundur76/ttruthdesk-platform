/**
 * memoryFeedbackLoop.test.ts
 *
 * Tests for the three memory feedback loop modules:
 *   1. mrAgentClient.ts        — HTTP client for evolva-mragent server
 *   2. mrAgentContradictionCheck.ts — real-time contradiction detection
 *   3. trainingExporter.ts     — autopilot training export
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock ENV so we can toggle mrAgentEnabled without env vars
vi.mock("./trainingBridge", () => ({
  emitVerdictEvent: vi.fn(),
  getPipelineStats: vi.fn(),
}));

vi.mock("./_core/env", () => ({
  ENV: {
    mrAgentEnabled: true,
    mrAgentUrl: "http://localhost:8002",
    trainingExportMinConfidence: 0.85,
    clfCorpusPath: "",
    hallOumiEnabled: false,
    hallOumiUrl: "http://localhost:8001",
    hallOumiModel: "halloumi-8b",
  },
}));

// Mock global fetch so we don't make real HTTP calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeNetworkError(message = "ECONNREFUSED") {
  return Promise.reject(new Error(message));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. mrAgentClient
// ─────────────────────────────────────────────────────────────────────────────

describe("mrAgentClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchPriorContext", () => {
    it("returns null when mrAgentEnabled is false", async () => {
      const { ENV } = await import("./_core/env");
      (ENV as Record<string, unknown>).mrAgentEnabled = false;
      const { fetchPriorContext } = await import("./mrAgentClient");
      const result = await fetchPriorContext("some claim text");
      expect(result).toBeNull();
      (ENV as Record<string, unknown>).mrAgentEnabled = true;
    });

    it("returns context string when server responds with episodes", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          answer: "Previously verified: Darunavir inhibits HIV-1 protease.",
          episodes_used: 3,
        })
      );
      const { fetchPriorContext } = await import("./mrAgentClient");
      const result = await fetchPriorContext(
        "Does darunavir inhibit HIV-1 protease?"
      );
      expect(result).toBe(
        "Previously verified: Darunavir inhibits HIV-1 protease."
      );
    });

    it("returns null when server returns 0 episodes_used", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ answer: "", episodes_used: 0 })
      );
      const { fetchPriorContext } = await import("./mrAgentClient");
      const result = await fetchPriorContext("novel claim with no history");
      expect(result).toBeNull();
    });

    it("returns null when server returns error field", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          answer: "",
          episodes_used: 0,
          error: "DB unavailable",
        })
      );
      const { fetchPriorContext } = await import("./mrAgentClient");
      const result = await fetchPriorContext("some claim");
      expect(result).toBeNull();
    });

    it("returns null on network error (non-fatal)", async () => {
      mockFetch.mockImplementationOnce(() => makeNetworkError());
      const { fetchPriorContext } = await import("./mrAgentClient");
      const result = await fetchPriorContext("some claim");
      expect(result).toBeNull();
    });

    it("returns null on HTTP 500 (non-fatal)", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}, 500));
      const { fetchPriorContext } = await import("./mrAgentClient");
      const result = await fetchPriorContext("some claim");
      expect(result).toBeNull();
    });
  });

  describe("querySimilarVerdicts", () => {
    it("returns null when mrAgentEnabled is false", async () => {
      const { ENV } = await import("./_core/env");
      (ENV as Record<string, unknown>).mrAgentEnabled = false;
      const { querySimilarVerdicts } = await import("./mrAgentClient");
      const result = await querySimilarVerdicts("some claim");
      expect(result).toBeNull();
      (ENV as Record<string, unknown>).mrAgentEnabled = true;
    });

    it("returns episodes array on success", async () => {
      const episodes = [
        {
          episode_id: "ep-1",
          text: "VERDICT: Supported\nCLAIM: test",
          origin: "ttruthdesk",
          score: 0.92,
          citation: "https://pubmed.ncbi.nlm.nih.gov/123",
        },
        {
          episode_id: "ep-2",
          text: "VERDICT: Contradicted\nCLAIM: other",
          origin: "ttruthdesk",
          score: 0.75,
          citation: "",
        },
      ];
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ episodes, total_in_memory: 2 })
      );
      const { querySimilarVerdicts } = await import("./mrAgentClient");
      const result = await querySimilarVerdicts("test claim");
      expect(result).toHaveLength(2);
      expect(result![0].episode_id).toBe("ep-1");
    });

    it("returns null on error field in response", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ episodes: [], total_in_memory: 0, error: "timeout" })
      );
      const { querySimilarVerdicts } = await import("./mrAgentClient");
      const result = await querySimilarVerdicts("some claim");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockImplementationOnce(() => makeNetworkError());
      const { querySimilarVerdicts } = await import("./mrAgentClient");
      const result = await querySimilarVerdicts("some claim");
      expect(result).toBeNull();
    });
  });

  describe("ingestVerifiedClaim", () => {
    it("returns null when mrAgentEnabled is false", async () => {
      const { ENV } = await import("./_core/env");
      (ENV as Record<string, unknown>).mrAgentEnabled = false;
      const { ingestVerifiedClaim } = await import("./mrAgentClient");
      const result = await ingestVerifiedClaim({
        episodeId: "ep-1",
        text: "VERDICT: Supported\nCLAIM: test",
        origin: "ttruthdesk:claim:1",
        tags: ["structural_biology", "supported"],
        citation: "https://pubmed.ncbi.nlm.nih.gov/123",
      });
      expect(result).toBeNull();
      (ENV as Record<string, unknown>).mrAgentEnabled = true;
    });

    it("returns success result on ingest", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          success: true,
          episode_id: "ep-42",
          has_embedding: true,
        })
      );
      const { ingestVerifiedClaim } = await import("./mrAgentClient");
      const result = await ingestVerifiedClaim({
        episodeId: "ep-42",
        text: "VERDICT: Supported\nCLAIM: test claim",
        origin: "ttruthdesk:claim:42",
        tags: ["structural_biology"],
        citation: "https://pubmed.ncbi.nlm.nih.gov/456",
      });
      expect(result?.success).toBe(true);
      expect(result?.episode_id).toBe("ep-42");
    });

    it("returns null on network error", async () => {
      mockFetch.mockImplementationOnce(() => makeNetworkError());
      const { ingestVerifiedClaim } = await import("./mrAgentClient");
      const result = await ingestVerifiedClaim({
        episodeId: "ep-1",
        text: "VERDICT: Supported\nCLAIM: test",
        origin: "ttruthdesk:claim:1",
        tags: [],
        citation: "",
      });
      expect(result).toBeNull();
    });
  });

  describe("getMemoryStats", () => {
    it("returns stats on success", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          episode_count: 150,
          key_node_count: 50,
          link_count: 200,
        })
      );
      const { getMemoryStats } = await import("./mrAgentClient");
      const stats = await getMemoryStats();
      expect(stats?.episode_count).toBe(150);
    });

    it("returns null on network error", async () => {
      mockFetch.mockImplementationOnce(() => makeNetworkError());
      const { getMemoryStats } = await import("./mrAgentClient");
      const result = await getMemoryStats();
      expect(result).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. mrAgentContradictionCheck
// ─────────────────────────────────────────────────────────────────────────────

describe("mrAgentContradictionCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mrAgentEnabled to true
    import("./_core/env").then(({ ENV }) => {
      (ENV as Record<string, unknown>).mrAgentEnabled = true;
    });
  });

  it("returns detected=false for NEUTRAL verdict (Ambiguous)", async () => {
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Ambiguous"
    );
    expect(result.detected).toBe(false);
  });

  it("returns detected=false for NEUTRAL verdict (Insufficient Evidence)", async () => {
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Insufficient Evidence"
    );
    expect(result.detected).toBe(false);
  });

  it("returns detected=false for NEUTRAL verdict (Needs Expert Review)", async () => {
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Needs Expert Review"
    );
    expect(result.detected).toBe(false);
  });

  it("returns detected=false when no similar episodes found", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ episodes: [], total_in_memory: 0 })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Supported"
    );
    expect(result.detected).toBe(false);
  });

  it("returns detected=false when similar episode has same polarity", async () => {
    // Both Supported → no contradiction
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        episodes: [
          {
            episode_id: "ep-1",
            text: "VERDICT: Supported\nCLAIM: similar claim",
            origin: "ttruthdesk",
            score: 0.95,
            citation: "",
          },
        ],
        total_in_memory: 1,
      })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Supported"
    );
    expect(result.detected).toBe(false);
  });

  it("returns detected=false when similar episode has NEUTRAL stored verdict", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        episodes: [
          {
            episode_id: "ep-1",
            text: "VERDICT: Ambiguous\nCLAIM: similar claim",
            origin: "ttruthdesk",
            score: 0.95,
            citation: "",
          },
        ],
        total_in_memory: 1,
      })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Supported"
    );
    expect(result.detected).toBe(false);
  });

  it("returns detected=false when similarity score is below threshold", async () => {
    // Score 0.75 < SIMILARITY_THRESHOLD 0.80
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        episodes: [
          {
            episode_id: "ep-1",
            text: "VERDICT: Contradicted\nCLAIM: similar claim",
            origin: "ttruthdesk",
            score: 0.75,
            citation: "",
          },
        ],
        total_in_memory: 1,
      })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Supported"
    );
    expect(result.detected).toBe(false);
  });

  it("returns detected=true when Supported contradicts stored Contradicted", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        episodes: [
          {
            episode_id: "ep-99",
            text: "VERDICT: Contradicted\nCLAIM: similar claim",
            origin: "ttruthdesk",
            score: 0.92,
            citation: "https://pubmed.ncbi.nlm.nih.gov/789",
          },
        ],
        total_in_memory: 1,
      })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      5,
      "some claim",
      "Supported"
    );
    expect(result.detected).toBe(true);
    expect(result.storedVerdict).toBe("Contradicted");
    expect(result.storedEpisodeId).toBe("ep-99");
    expect(result.similarityScore).toBe(0.92);
    expect(result.newVerdict).toBe("Supported");
    expect(result.claimId).toBe(5);
  });

  it("returns detected=true when Contradicted contradicts stored Supported", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        episodes: [
          {
            episode_id: "ep-10",
            text: "VERDICT: Supported\nCLAIM: similar claim",
            origin: "ttruthdesk",
            score: 0.88,
            citation: "",
          },
        ],
        total_in_memory: 1,
      })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      7,
      "some claim",
      "Contradicted"
    );
    expect(result.detected).toBe(true);
    expect(result.storedVerdict).toBe("Supported");
  });

  it("returns detected=true when Contradicted contradicts stored Partially Supported", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        episodes: [
          {
            episode_id: "ep-11",
            text: "VERDICT: Partially Supported\nCLAIM: similar claim",
            origin: "ttruthdesk",
            score: 0.85,
            citation: "",
          },
        ],
        total_in_memory: 1,
      })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      8,
      "some claim",
      "Contradicted"
    );
    expect(result.detected).toBe(true);
    expect(result.storedVerdict).toBe("Partially Supported");
  });

  it("returns detected=false on network error (non-fatal)", async () => {
    mockFetch.mockImplementationOnce(() => makeNetworkError());
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Supported"
    );
    expect(result.detected).toBe(false);
  });

  it("returns detected=false when episode text has no VERDICT: prefix", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        episodes: [
          {
            episode_id: "ep-1",
            text: "no verdict prefix here",
            origin: "ttruthdesk",
            score: 0.95,
            citation: "",
          },
        ],
        total_in_memory: 1,
      })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(
      1,
      "some claim",
      "Supported"
    );
    expect(result.detected).toBe(false);
  });

  it("always includes claimId and newVerdict in result", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({ episodes: [], total_in_memory: 0 })
    );
    const { checkMrAgentContradiction } = await import(
      "./mrAgentContradictionCheck"
    );
    const result = await checkMrAgentContradiction(42, "test", "Supported");
    expect(result.claimId).toBe(42);
    expect(result.newVerdict).toBe("Supported");
    expect(result.detectedAt).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. trainingExporter
// ─────────────────────────────────────────────────────────────────────────────

describe("trainingExporter", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "training-exporter-test-"));
    // Reset ENV
    import("./_core/env").then(({ ENV }) => {
      (ENV as Record<string, unknown>).mrAgentEnabled = true;
      (ENV as Record<string, unknown>).trainingExportMinConfidence = 0.85;
      (ENV as Record<string, unknown>).clfCorpusPath = "";
    });
  });

  afterEach(() => {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("skips export when confidenceScore is below threshold", async () => {
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    const result = await exportHighConfidenceVerdict({
      claimId: 1,
      claimText: "test claim",
      verdict: "Supported",
      confidenceScore: 0.7, // below 0.85
      citation: "https://pubmed.ncbi.nlm.nih.gov/123",
      domain: "structural_biology",
    });
    expect(result.exported).toBe(false);
    expect(result.channels).toHaveLength(0);
    expect(result.skippedReason).toContain("0.700");
  });

  it("skips export when all channels unavailable", async () => {
    const { ENV } = await import("./_core/env");
    (ENV as Record<string, unknown>).mrAgentEnabled = false;
    (ENV as Record<string, unknown>).clfCorpusPath = "";
    // Also make trainingBridge throw so Channel 3 fails too
    const { emitVerdictEvent } = await import("./trainingBridge");
    vi.mocked(emitVerdictEvent).mockImplementationOnce(() => {
      throw new Error("trainingBridge unavailable");
    });
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    const result = await exportHighConfidenceVerdict({
      claimId: 1,
      claimText: "test claim",
      verdict: "Supported",
      confidenceScore: 0.9,
      citation: "",
      domain: "structural_biology",
    });
    expect(result.exported).toBe(false);
    expect(result.skippedReason).toContain("no export channels");
    (ENV as Record<string, unknown>).mrAgentEnabled = true;
    vi.mocked(emitVerdictEvent).mockReset();
  });

  it("exports to MRAgent when enabled and confidence is sufficient", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        success: true,
        episode_id: "ep-100",
        has_embedding: true,
      })
    );
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    const result = await exportHighConfidenceVerdict({
      claimId: 10,
      claimText: "Darunavir inhibits HIV-1 protease",
      verdict: "Supported",
      confidenceScore: 0.92,
      citation: "https://pubmed.ncbi.nlm.nih.gov/999",
      domain: "hiv_protease",
    });
    expect(result.exported).toBe(true);
    expect(result.channels).toContain("mrAgent");
  });

  it("exports to CLF corpus JSONL file when clfCorpusPath is set", async () => {
    const { ENV } = await import("./_core/env");
    const corpusFile = path.join(tmpDir, "corpus.jsonl");
    (ENV as Record<string, unknown>).mrAgentEnabled = false;
    (ENV as Record<string, unknown>).clfCorpusPath = corpusFile;
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    const result = await exportHighConfidenceVerdict({
      claimId: 20,
      claimText: "Aspirin reduces fever",
      verdict: "Supported",
      confidenceScore: 0.9,
      citation: "https://pubmed.ncbi.nlm.nih.gov/111",
      domain: "pharmacology",
    });
    expect(result.exported).toBe(true);
    expect(result.channels).toContain("clfCorpus");
    // Verify JSONL line was written
    const content = fs.readFileSync(corpusFile, "utf8");
    const line = JSON.parse(content.trim());
    expect(line.id).toBe("20");
    expect(line.label).toBe("Supported");
    expect(line.confidence).toBe(0.9);
    expect(line.domain).toBe("pharmacology");
    expect(line.text).toContain("VERDICT: Supported");
    expect(line.text).toContain("Aspirin reduces fever");
    (ENV as Record<string, unknown>).mrAgentEnabled = true;
    (ENV as Record<string, unknown>).clfCorpusPath = "";
  });

  it("appends multiple JSONL lines to the same corpus file", async () => {
    const { ENV } = await import("./_core/env");
    const corpusFile = path.join(tmpDir, "corpus.jsonl");
    (ENV as Record<string, unknown>).mrAgentEnabled = false;
    (ENV as Record<string, unknown>).clfCorpusPath = corpusFile;
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    await exportHighConfidenceVerdict({
      claimId: 1,
      claimText: "claim 1",
      verdict: "Supported",
      confidenceScore: 0.9,
      citation: "",
      domain: "test",
    });
    await exportHighConfidenceVerdict({
      claimId: 2,
      claimText: "claim 2",
      verdict: "Contradicted",
      confidenceScore: 0.88,
      citation: "",
      domain: "test",
    });
    const lines = fs.readFileSync(corpusFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("1");
    expect(JSON.parse(lines[1]).id).toBe("2");
    (ENV as Record<string, unknown>).mrAgentEnabled = true;
    (ENV as Record<string, unknown>).clfCorpusPath = "";
  });

  it("exports to both channels when both are available", async () => {
    const { ENV } = await import("./_core/env");
    const corpusFile = path.join(tmpDir, "corpus.jsonl");
    (ENV as Record<string, unknown>).mrAgentEnabled = true;
    (ENV as Record<string, unknown>).clfCorpusPath = corpusFile;
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        success: true,
        episode_id: "ep-200",
        has_embedding: true,
      })
    );
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    const result = await exportHighConfidenceVerdict({
      claimId: 30,
      claimText: "test claim both channels",
      verdict: "Supported",
      confidenceScore: 0.95,
      citation: "https://example.com",
      domain: "test",
    });
    expect(result.exported).toBe(true);
    expect(result.channels).toContain("mrAgent");
    expect(result.channels).toContain("clfCorpus");
    (ENV as Record<string, unknown>).clfCorpusPath = "";
  });

  it("still exports to CLF corpus when MRAgent ingest fails", async () => {
    const { ENV } = await import("./_core/env");
    const corpusFile = path.join(tmpDir, "corpus.jsonl");
    (ENV as Record<string, unknown>).mrAgentEnabled = true;
    (ENV as Record<string, unknown>).clfCorpusPath = corpusFile;
    mockFetch.mockImplementationOnce(() => makeNetworkError());
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    const result = await exportHighConfidenceVerdict({
      claimId: 40,
      claimText: "fallback claim",
      verdict: "Supported",
      confidenceScore: 0.9,
      citation: "",
      domain: "test",
    });
    expect(result.exported).toBe(true);
    expect(result.channels).toContain("clfCorpus");
    expect(result.channels).not.toContain("mrAgent");
    (ENV as Record<string, unknown>).clfCorpusPath = "";
  });

  it("creates parent directory for CLF corpus if it does not exist", async () => {
    const { ENV } = await import("./_core/env");
    const nestedPath = path.join(tmpDir, "nested", "deep", "corpus.jsonl");
    (ENV as Record<string, unknown>).mrAgentEnabled = false;
    (ENV as Record<string, unknown>).clfCorpusPath = nestedPath;
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    await exportHighConfidenceVerdict({
      claimId: 50,
      claimText: "nested test",
      verdict: "Supported",
      confidenceScore: 0.9,
      citation: "",
      domain: "test",
    });
    expect(fs.existsSync(nestedPath)).toBe(true);
    (ENV as Record<string, unknown>).mrAgentEnabled = true;
    (ENV as Record<string, unknown>).clfCorpusPath = "";
  });

  it("JSONL line contains exportedAt ISO timestamp", async () => {
    const { ENV } = await import("./_core/env");
    const corpusFile = path.join(tmpDir, "corpus.jsonl");
    (ENV as Record<string, unknown>).mrAgentEnabled = false;
    (ENV as Record<string, unknown>).clfCorpusPath = corpusFile;
    const { exportHighConfidenceVerdict } = await import("./trainingExporter");
    await exportHighConfidenceVerdict({
      claimId: 60,
      claimText: "timestamp test",
      verdict: "Supported",
      confidenceScore: 0.9,
      citation: "",
      domain: "test",
    });
    const line = JSON.parse(fs.readFileSync(corpusFile, "utf8").trim());
    expect(line.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    (ENV as Record<string, unknown>).mrAgentEnabled = true;
    (ENV as Record<string, unknown>).clfCorpusPath = "";
  });
});
