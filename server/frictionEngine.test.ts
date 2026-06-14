/**
 * frictionEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the FrictionEngine — 7-stage self-prompting loop.
 *
 * All LLM and DB dependencies are mocked. Tests verify:
 *   1. runPreflightScan returns a valid FrictionEngineResult shape
 *   2. runPreflightScan falls back gracefully when LLM errors
 *   3. runPreflightScan truncates long documents (>8000 chars)
 *   4. runOutputAudit returns a valid OutputAuditResult shape
 *   5. runOutputAudit falls back to "pass" on LLM error
 *   6. recommended_action is one of the four valid values
 *   7. priorGraphSignals are populated from findClaimsByTextSimilarity
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks to avoid initialization order issues ─────────────────────────
const { mockInvokeMultiLLM, mockFindClaimsByTextSimilarity } = vi.hoisted(
  () => ({
    mockInvokeMultiLLM: vi.fn(),
    mockFindClaimsByTextSimilarity: vi.fn(),
  })
);

vi.mock("./_core/multiLLM", () => ({
  invokeMultiLLM: mockInvokeMultiLLM,
}));

vi.mock("./graphTraversal", () => ({
  findClaimsByTextSimilarity: mockFindClaimsByTextSimilarity,
}));

vi.mock("./logger", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: () => log, errData: (e: unknown) => e };
});

// ─── Import after mocks ───────────────────────────────────────────────────────
import {
  runPreflightScan,
  runOutputAudit,
  type FrictionEngineResult,
  type OutputAuditResult,
} from "./frictionEngine";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeFrictionResponse(overrides: Partial<FrictionEngineResult> = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            surface_request: "Audit this document for verifiable claims.",
            inferred_intent: "Verify protein function claims against PDB.",
            assumptions: [
              {
                statement: "This assumes the protein is correctly identified.",
                type: "scientific",
                risk: "medium",
                test: "Cross-check protein name against UniProt.",
              },
            ],
            constraints: [
              {
                constraint: "Must use authoritative databases.",
                classification: "hard",
                evidence: "User explicitly requested authoritative sources.",
              },
            ],
            friction_question:
              "Which specific protein isoform are you referring to?",
            optimized_prompt:
              "Audit claims about Lysozyme C (P61626) in Homo sapiens.",
            validation_criteria: [
              "All verifiable claims must be checked against at least one authoritative database.",
            ],
            remaining_uncertainty: "Isoform specificity unclear.",
            recommended_action: "ask_user",
            claims: [
              {
                text: "Lysozyme has antimicrobial activity.",
                category: "database_verifiable",
                confidence: 0.9,
                source: "UniProt P61626",
              },
            ],
            totalClaims: 1,
            databaseVerifiable: 1,
            assumptionSmuggled: 0,
            likelyContradicted: 0,
            outOfScope: 0,
            opinionOrNarrative: 0,
            ...overrides,
          }),
        },
      },
    ],
  };
}

function makeAuditResponse(overrides: Partial<OutputAuditResult> = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            satisfiesDeepIntent: true,
            reliesOnUnverifiedAssumptions: false,
            distinguishesFactsFromGuesses: true,
            addressesValidationCriteria: true,
            verdict: "pass",
            reason: "All claims are verifiable.",
            suggestedRevision: null,
            ...overrides,
          }),
        },
      },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("frictionEngine — runPreflightScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindClaimsByTextSimilarity.mockResolvedValue([]);
  });

  it("returns a valid FrictionEngineResult shape on success", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce(makeFrictionResponse());

    const result = await runPreflightScan(
      "Lysozyme has antimicrobial activity."
    );

    expect(result.surface_request).toBeTruthy();
    expect(result.inferred_intent).toBeTruthy();
    expect(Array.isArray(result.assumptions)).toBe(true);
    expect(Array.isArray(result.constraints)).toBe(true);
    expect(Array.isArray(result.claims)).toBe(true);
    expect(result.totalClaims).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.raw_prompt).toContain("Lysozyme");
  });

  it("recommended_action is one of the four valid values", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce(makeFrictionResponse());

    const result = await runPreflightScan("Test document.");

    expect(["execute", "ask_user", "reject", "reframe"]).toContain(
      result.recommended_action
    );
  });

  it("falls back gracefully when LLM throws", async () => {
    mockInvokeMultiLLM.mockRejectedValueOnce(new Error("LLM unavailable"));

    const result = await runPreflightScan("Some document text.");

    // Fallback should still return a valid shape
    expect(result.raw_prompt).toBeTruthy();
    expect(result.recommended_action).toBe("execute");
    expect(result.assumptions).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("falls back gracefully when LLM returns malformed JSON", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "not valid json {{" } }],
    });

    const result = await runPreflightScan("Some document text.");

    expect(result.recommended_action).toBe("execute");
    expect(result.assumptions).toEqual([]);
  });

  it("truncates documents longer than 8000 characters", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce(makeFrictionResponse());

    const longDoc = "A".repeat(10000);
    await runPreflightScan(longDoc);

    const calledMessages = mockInvokeMultiLLM.mock.calls[0][0].messages;
    const userContent = calledMessages.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    // The truncated text + label should be shorter than the original
    expect(userContent.length).toBeLessThan(10000);
    expect(userContent).toContain("[Document truncated for preflight scan]");
  });

  it("does NOT truncate documents shorter than 8000 characters", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce(makeFrictionResponse());

    const shortDoc = "Short document about Lysozyme.";
    await runPreflightScan(shortDoc);

    const calledMessages = mockInvokeMultiLLM.mock.calls[0][0].messages;
    const userContent = calledMessages.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userContent).not.toContain(
      "[Document truncated for preflight scan]"
    );
    expect(userContent).toContain(shortDoc);
  });

  it("populates priorGraphSignals from findClaimsByTextSimilarity", async () => {
    const mockSignals = [
      {
        claimId: 1,
        claimText: "Lysozyme binds peptidoglycan",
        similarity: 0.87,
      },
    ];
    mockFindClaimsByTextSimilarity.mockResolvedValueOnce(mockSignals);
    mockInvokeMultiLLM.mockResolvedValueOnce(makeFrictionResponse());

    const result = await runPreflightScan(
      "Lysozyme has antimicrobial activity."
    );

    expect(result.priorGraphSignals).toEqual(mockSignals);
  });

  it("handles empty priorGraphSignals when findClaimsByTextSimilarity returns empty", async () => {
    mockFindClaimsByTextSimilarity.mockResolvedValueOnce([]);
    mockInvokeMultiLLM.mockResolvedValueOnce(makeFrictionResponse());

    const result = await runPreflightScan("Some text.");

    expect(result.priorGraphSignals).toEqual([]);
  });
});

describe("frictionEngine — runOutputAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a valid OutputAuditResult shape on success", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce(makeAuditResponse());

    const result = await runOutputAudit(
      "Audit Lysozyme claims.",
      "Lysozyme has well-documented antimicrobial activity (UniProt P61626)."
    );

    expect(result.verdict).toBeTruthy();
    expect(typeof result.satisfiesDeepIntent).toBe("boolean");
    expect(typeof result.reliesOnUnverifiedAssumptions).toBe("boolean");
    expect(typeof result.distinguishesFactsFromGuesses).toBe("boolean");
    expect(typeof result.addressesValidationCriteria).toBe("boolean");
    expect(result.reason).toBeTruthy();
  });

  it("verdict is one of pass | revise | ask_user | reject", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce(
      makeAuditResponse({ verdict: "revise" })
    );

    const result = await runOutputAudit("prompt", "answer");

    expect(["pass", "revise", "ask_user", "reject"]).toContain(result.verdict);
  });

  it("falls back to pass verdict when LLM throws", async () => {
    mockInvokeMultiLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await runOutputAudit("prompt", "answer");

    expect(result.verdict).toBe("pass");
    expect(result.satisfiesDeepIntent).toBe(true);
    expect(result.reason).toContain("unavailable");
  });

  it("falls back to pass verdict when LLM returns malformed JSON", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "{{bad json}}" } }],
    });

    const result = await runOutputAudit("prompt", "answer");

    expect(result.verdict).toBe("pass");
  });

  it("passes validation criteria to the LLM prompt", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce(makeAuditResponse());

    await runOutputAudit("prompt", "answer", ["Criterion 1", "Criterion 2"]);

    const calledMessages = mockInvokeMultiLLM.mock.calls[0][0].messages;
    const userContent = calledMessages.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userContent).toContain("Criterion 1");
    expect(userContent).toContain("Criterion 2");
  });

  it("works without validation criteria (empty array default)", async () => {
    mockInvokeMultiLLM.mockResolvedValueOnce(makeAuditResponse());

    const result = await runOutputAudit("prompt", "answer");

    expect(result.verdict).toBeTruthy();
  });
});
