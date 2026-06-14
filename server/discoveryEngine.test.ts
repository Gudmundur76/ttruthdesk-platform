/**
 * discoveryEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for discoveryEngine.ts.
 * Tests: BUILT_IN_SOURCES shape, probeSource(), generateAdapterStub().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockInvokeLLM } = vi.hoisted(() => ({
  mockInvokeLLM: vi.fn(),
}));

vi.mock("./_core/llm", () => ({ invokeLLM: mockInvokeLLM }));

import {
  BUILT_IN_SOURCES,
  probeSource,
  generateAdapterStub,
  type BuiltInSource,
} from "./discoveryEngine";

// ─── BUILT_IN_SOURCES ─────────────────────────────────────────────────────────
describe("discoveryEngine — BUILT_IN_SOURCES", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(BUILT_IN_SOURCES)).toBe(true);
    expect(BUILT_IN_SOURCES.length).toBeGreaterThan(0);
  });

  it("every source has required fields", () => {
    for (const source of BUILT_IN_SOURCES) {
      expect(typeof source.sourceId).toBe("string");
      expect(typeof source.displayName).toBe("string");
      expect(typeof source.baseUrl).toBe("string");
      expect(typeof source.probeEndpoint).toBe("string");
      expect(typeof source.category).toBe("string");
      expect(typeof source.schemaDescription).toBe("string");
    }
  });

  it("sourceIds are unique", () => {
    const ids = BUILT_IN_SOURCES.map((s) => s.sourceId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("probeEndpoints are valid URLs", () => {
    for (const source of BUILT_IN_SOURCES) {
      expect(() => new URL(source.probeEndpoint)).not.toThrow();
    }
  });
});

// ─── probeSource ──────────────────────────────────────────────────────────────
describe("discoveryEngine — probeSource()", () => {
  const mockSource: BuiltInSource = {
    sourceId: "test_source",
    displayName: "Test Source",
    baseUrl: "https://api.test.example.com",
    probeEndpoint: "https://api.test.example.com/health",
    category: "protein_structure",
    verticals: ["structural_biology"],
    schemaDescription: "Test schema",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns isHealthy:true when fetch returns 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    );

    const result = await probeSource(mockSource);

    expect(result.sourceId).toBe("test_source");
    expect(result.isHealthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns isHealthy:false when fetch returns 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );

    const result = await probeSource(mockSource);

    expect(result.isHealthy).toBe(false);
    expect(result.statusCode).toBe(500);
  });

  it("returns isHealthy:false and errorMessage when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const result = await probeSource(mockSource);

    expect(result.isHealthy).toBe(false);
    expect(typeof result.errorMessage).toBe("string");
    expect(result.errorMessage).toContain("Network error");
  });

  it("includes sourceId in result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    );

    const result = await probeSource(mockSource);

    expect(result.sourceId).toBe(mockSource.sourceId);
  });
});

// ─── generateAdapterStub ──────────────────────────────────────────────────────
describe("discoveryEngine — generateAdapterStub()", () => {
  const mockSource: BuiltInSource = {
    sourceId: "open_alex",
    displayName: "OpenAlex",
    baseUrl: "https://api.openalex.org",
    probeEndpoint: "https://api.openalex.org/works?per-page=1",
    category: "literature",
    verticals: ["structural_biology"],
    schemaDescription: "Academic paper metadata with DOI, title, abstract",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns LLM-generated code when LLM responds", async () => {
    const generatedCode = `// OpenAlex adapter
export async function fetchOpenAlex(query: string) { return []; }`;
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: generatedCode } }],
    });

    const result = await generateAdapterStub(mockSource);

    expect(typeof result).toBe("string");
    expect(result).toBe(generatedCode);
  });

  it("returns fallback stub when LLM returns null content", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    const result = await generateAdapterStub(mockSource);

    expect(typeof result).toBe("string");
    expect(result).toContain("fetchOpenAlex");
  });

  it("returns fallback stub when LLM throws", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("LLM unavailable"));

    const result = await generateAdapterStub(mockSource);

    expect(typeof result).toBe("string");
    expect(result).toContain("fetchOpenAlex");
  });

  it("fallback stub contains the correct function name for snake_case sourceId", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("LLM unavailable"));
    const source = { ...mockSource, sourceId: "europe_pmc" };

    const result = await generateAdapterStub(source);

    // toPascalCase("europe_pmc") → "EuropePmc"
    expect(result).toContain("fetchEuropePmc");
  });

  it("calls invokeLLM with the source details in the prompt", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [{ message: { content: "// stub" } }],
    });

    await generateAdapterStub(mockSource);

    expect(mockInvokeLLM).toHaveBeenCalledOnce();
    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const userContent = callArgs.messages[1].content;
    expect(userContent).toContain("OpenAlex");
  });
});
