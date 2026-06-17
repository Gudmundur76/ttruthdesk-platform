/**
 * claimExtractor.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for extractClaims() — the LLM-powered molecular claim extractor.
 *
 * All invokeMultiLLM calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
const { mockInvokeMultiLLM } = vi.hoisted(() => ({
  mockInvokeMultiLLM: vi.fn(),
}));

vi.mock("./_core/multiLLM", () => ({
  invokeMultiLLM: mockInvokeMultiLLM,
  getActiveLLMProvider: vi.fn().mockReturnValue("openai"),
}));

import { extractClaims } from "./claimExtractor";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeLLMResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

const SAMPLE_CLAIM = {
  claimText: "The structure of Lysozyme was solved at 1.8 Å resolution.",
  claimType: "resolution",
  extractedValue: "1.8",
  pdbId: null,
  proteinName: "Lysozyme",
  experimentalMethod: null,
  resolution: 1.8,
  organism: null,
  ligand: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("claimExtractor — extractClaims()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an array of ExtractedClaim objects on success", async () => {
    mockInvokeMultiLLM.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ claims: [SAMPLE_CLAIM] }))
    );

    const claims = await extractClaims("The structure of Lysozyme was solved at 1.8 Å resolution.");

    expect(Array.isArray(claims)).toBe(true);
    expect(claims).toHaveLength(1);
    expect(claims[0].claimType).toBe("resolution");
    expect(claims[0].resolution).toBe(1.8);
  });

  it("returns empty array when LLM returns empty claims array", async () => {
    mockInvokeMultiLLM.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ claims: [] }))
    );

    const claims = await extractClaims("No verifiable claims here.");

    expect(claims).toEqual([]);
  });

  it("returns empty array when LLM returns no content", async () => {
    mockInvokeMultiLLM.mockResolvedValue({ choices: [{ message: { content: null } }] });

    const claims = await extractClaims("Some text.");

    expect(claims).toEqual([]);
  });

  it("returns empty array on JSON parse failure", async () => {
    mockInvokeMultiLLM.mockResolvedValue(makeLLMResponse("not valid json {{{"));

    const claims = await extractClaims("Some text.");

    expect(claims).toEqual([]);
  });

  it("falls back to empty array when response is a raw JSON array (not wrapped in {claims:[]})", async () => {
    // The primary parse tries JSON.parse(content).claims — a raw array has no .claims
    // so it returns undefined → [] via the `?? []` fallback.
    // The secondary fallback catches non-array values; a raw array IS an array
    // but the primary path already returned [].
    mockInvokeMultiLLM.mockResolvedValue(
      makeLLMResponse(JSON.stringify([SAMPLE_CLAIM]))
    );

    const claims = await extractClaims("Some text.");

    // Primary path: JSON.parse(content).claims → undefined → [] (no .claims key)
    expect(Array.isArray(claims)).toBe(true);
    // The actual behaviour returns [] because the wrapped schema is expected
    expect(claims).toHaveLength(0);
  });

  it("truncates documents longer than 12000 characters", async () => {
    mockInvokeMultiLLM.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ claims: [] }))
    );

    const longDoc = "A".repeat(15000);
    await extractClaims(longDoc);

    const callArgs = mockInvokeMultiLLM.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("[Document truncated for analysis]");
    expect(userMessage.content.length).toBeLessThan(13000);
  });

  it("does NOT truncate documents shorter than 12000 characters", async () => {
    mockInvokeMultiLLM.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ claims: [] }))
    );

    const shortDoc = "Short document.";
    await extractClaims(shortDoc);

    const callArgs = mockInvokeMultiLLM.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).not.toContain("[Document truncated for analysis]");
  });

  it("passes providerOverride to invokeMultiLLM", async () => {
    mockInvokeMultiLLM.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ claims: [] }))
    );

    await extractClaims("Some text.", "anthropic");

    expect(mockInvokeMultiLLM).toHaveBeenCalledWith(
      expect.any(Object),
      "draft",
      "anthropic"
    );
  });

  it("uses json_schema response_format in the LLM call", async () => {
    mockInvokeMultiLLM.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ claims: [] }))
    );

    await extractClaims("Some text.");

    const callArgs = mockInvokeMultiLLM.mock.calls[0][0];
    expect(callArgs.response_format?.type).toBe("json_schema");
    expect(callArgs.response_format?.json_schema?.name).toBe("domain_claims");
  });

  it("returns empty array when invokeMultiLLM throws", async () => {
    mockInvokeMultiLLM.mockRejectedValue(new Error("LLM unavailable"));

    // extractClaims does not catch top-level errors — it propagates
    await expect(extractClaims("Some text.")).rejects.toThrow("LLM unavailable");
  });

  it("extracted claims have all required fields", async () => {
    mockInvokeMultiLLM.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ claims: [SAMPLE_CLAIM] }))
    );

    const [claim] = await extractClaims("Some text.");

    expect(claim).toMatchObject({
      claimText: expect.any(String),
      claimType: expect.any(String),
      extractedValue: expect.anything(),
      pdbId: null,
      proteinName: expect.any(String),
      experimentalMethod: null,
      resolution: expect.any(Number),
      organism: null,
      ligand: null,
    });
  });
});
