/**
 * hallOumiAdapter.test.ts
 *
 * Tests for the HallOumi-8B secondary verification signal adapter.
 * Covers: parseHallOumiResponse, augmentWithHallOumi (mocked server + db).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseHallOumiResponse,
  augmentWithHallOumi,
  type HallOumiResult,
} from "./hallOumiAdapter";

// ── Mock ENV ──────────────────────────────────────────────────────────────────
vi.mock("./_core/env", () => ({
  ENV: {
    hallOumiEnabled: true,
    hallOumiUrl: "http://localhost:8001",
    hallOumiModel: "halloumi-8b",
  },
}));

// ── Mock db ───────────────────────────────────────────────────────────────────
const mockUpdateClaimVerdict = vi.fn().mockResolvedValue(undefined);
vi.mock("./db", () => ({
  updateClaimVerdict: (...args: unknown[]) => mockUpdateClaimVerdict(...args),
}));

// ── Mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Helper ────────────────────────────────────────────────────────────────────
function makeVerdictResult(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "Ambiguous" as const,
    rationale: "Evidence is conflicting.",
    evidenceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345",
    evidenceRaw: { abstract: "This study found mixed results." },
    ...overrides,
  };
}

function mockServerResponse(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
    text: async () => content,
  });
}

// ── parseHallOumiResponse ─────────────────────────────────────────────────────
describe("parseHallOumiResponse", () => {
  it("parses a single supported verdict", () => {
    const raw =
      "Creatine improves cognitive performance. |supported| 0.87\n\nThe study confirms this.";
    const result: HallOumiResult = parseHallOumiResponse(raw);
    expect(result.supported).toBe(true);
    expect(result.confidence).toBeCloseTo(0.87);
    expect(result.rationale).toContain("study confirms");
    expect(result.rawResponse).toBe(raw);
  });

  it("parses a single unsupported verdict", () => {
    const raw =
      "Protein X causes cancer. |unsupported| 0.92\n\nNo evidence found in context.";
    const result = parseHallOumiResponse(raw);
    expect(result.supported).toBe(false);
    expect(result.confidence).toBeCloseTo(0.92);
  });

  it("aggregates multiple verdict lines — majority supported", () => {
    const raw = [
      "Sentence one. |supported| 0.9",
      "Sentence two. |supported| 0.8",
      "Sentence three. |unsupported| 0.6",
    ].join("\n");
    const result = parseHallOumiResponse(raw);
    expect(result.supported).toBe(true);
    // Average confidence: (0.9 + 0.8 + 0.6) / 3 ≈ 0.767
    expect(result.confidence).toBeCloseTo(0.767, 2);
  });

  it("aggregates multiple verdict lines — majority unsupported", () => {
    const raw = [
      "Sentence one. |unsupported| 0.9",
      "Sentence two. |unsupported| 0.85",
      "Sentence three. |supported| 0.4",
    ].join("\n");
    const result = parseHallOumiResponse(raw);
    expect(result.supported).toBe(false);
  });

  it("handles case-insensitive verdict tags", () => {
    const raw = "Some claim. |SUPPORTED| 0.75";
    const result = parseHallOumiResponse(raw);
    expect(result.supported).toBe(true);
    expect(result.confidence).toBeCloseTo(0.75);
  });

  it("clamps confidence to [0, 1]", () => {
    const raw = "Claim. |supported| 1.5";
    const result = parseHallOumiResponse(raw);
    expect(result.confidence).toBe(1.0);
  });

  it("returns unsupported with 0 confidence for empty input", () => {
    const result = parseHallOumiResponse("");
    expect(result.supported).toBe(false);
    expect(result.confidence).toBe(0.0);
  });

  it("returns unsupported with 0 confidence when no verdict lines found", () => {
    const result = parseHallOumiResponse("This is just a plain explanation.");
    expect(result.supported).toBe(false);
    expect(result.confidence).toBe(0.0);
  });

  it("handles missing confidence value — defaults to 0.5", () => {
    const raw = "Claim. |supported|";
    const result = parseHallOumiResponse(raw);
    expect(result.supported).toBe(true);
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it("truncates rationale to 1000 chars", () => {
    const longLine = "A".repeat(2000);
    const raw = `Claim. |supported| 0.8\n${longLine}`;
    const result = parseHallOumiResponse(raw);
    expect(result.rationale.length).toBeLessThanOrEqual(1000);
  });
});

// ── augmentWithHallOumi ───────────────────────────────────────────────────────
describe("augmentWithHallOumi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the HallOumi server and persists the result", async () => {
    mockServerResponse("Creatine improves cognition. |supported| 0.88\n\nStrong evidence.");
    await augmentWithHallOumi(42, "Creatine improves cognition.", makeVerdictResult());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8001/v1/chat/completions");
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe("halloumi-8b");
    expect(body.temperature).toBe(0.0);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("Creatine improves cognition.");

    expect(mockUpdateClaimVerdict).toHaveBeenCalledWith(42, {
      hallOumiSupported: true,
      hallOumiConfidence: expect.closeTo(0.88, 2),
      hallOumiRationale: expect.stringContaining("Strong evidence"),
    });
  });

  it("does not call db when server returns an error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });
    await augmentWithHallOumi(99, "Some claim.", makeVerdictResult());
    expect(mockUpdateClaimVerdict).not.toHaveBeenCalled();
  });

  it("does not call db when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await augmentWithHallOumi(99, "Some claim.", makeVerdictResult());
    expect(mockUpdateClaimVerdict).not.toHaveBeenCalled();
  });

  it("does not call db when server returns empty content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
      text: async () => "",
    });
    await augmentWithHallOumi(99, "Some claim.", makeVerdictResult());
    expect(mockUpdateClaimVerdict).not.toHaveBeenCalled();
  });

  it("includes evidence text from evidenceRaw.abstract in the prompt", async () => {
    mockServerResponse("Claim. |supported| 0.7");
    const result = makeVerdictResult({
      evidenceRaw: { abstract: "The abstract says protein X is beneficial." },
    });
    await augmentWithHallOumi(1, "Protein X is beneficial.", result);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.messages[1].content).toContain("protein X is beneficial");
  });

  it("falls back to rationale text when evidenceRaw has no known text fields", async () => {
    mockServerResponse("Claim. |unsupported| 0.6");
    const result = makeVerdictResult({
      evidenceRaw: { someOtherField: 42 },
      rationale: "Deterministic rationale text.",
    });
    await augmentWithHallOumi(2, "Some claim.", result);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.messages[1].content).toContain("Deterministic rationale text.");
  });

  it("includes evidence URL in the context when present", async () => {
    mockServerResponse("Claim. |supported| 0.8");
    const result = makeVerdictResult({
      evidenceUrl: "https://example.com/paper",
      evidenceRaw: null,
    });
    await augmentWithHallOumi(3, "Some claim.", result);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.messages[1].content).toContain("https://example.com/paper");
  });

  it("persists unsupported result correctly", async () => {
    mockServerResponse("Claim is false. |unsupported| 0.91\n\nNo supporting evidence.");
    await augmentWithHallOumi(55, "Claim is false.", makeVerdictResult());
    expect(mockUpdateClaimVerdict).toHaveBeenCalledWith(55, {
      hallOumiSupported: false,
      hallOumiConfidence: expect.closeTo(0.91, 2),
      hallOumiRationale: expect.stringContaining("No supporting evidence"),
    });
  });
});
