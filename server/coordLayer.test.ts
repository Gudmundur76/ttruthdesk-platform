/**
 * coordLayer.test.ts
 * Unit tests for the Manus Coordination Layer:
 *  - verticalFeedConfig: new verticals present and valid
 *  - manusOrchestrator: buildVerticalAgentPrompt output
 *  - coordApi: createCoordRouter returns an Express router
 */
import { describe, it, expect } from "vitest";
import {
  VERTICAL_FEED_CONFIGS,
  getVerticalFeedConfig,
} from "./verticalFeedConfig";
import {
  buildVerticalAgentPrompt,
} from "./manusOrchestrator";
import { createCoordRouter } from "./coordApi";

// ─── verticalFeedConfig tests ─────────────────────────────────────────────────

describe("VERTICAL_FEED_CONFIGS", () => {
  it("contains at least 8 verticals (2 original + 6 new)", () => {
    expect(VERTICAL_FEED_CONFIGS.length).toBeGreaterThanOrEqual(8);
  });

  it("includes all 6 new coordination-layer verticals", () => {
    const keys = VERTICAL_FEED_CONFIGS.map((v) => v.domainKey);
    expect(keys).toContain("protein_supplement");
    expect(keys).toContain("creatine_ergogenics");
    expect(keys).toContain("gut_microbiome");
    expect(keys).toContain("collagen_peptides");
    expect(keys).toContain("plant_based_protein");
    expect(keys).toContain("sports_nutrition_rct");
  });

  it("every vertical has at least 1 meshQuery and a positive maxResultsPerQuery", () => {
    for (const v of VERTICAL_FEED_CONFIGS) {
      expect(v.meshQueries.length).toBeGreaterThan(0);
      expect(v.maxResultsPerQuery).toBeGreaterThan(0);
      // All queries must include the PMC Open Access filter
      for (const q of v.meshQueries) {
        expect(q).toContain("free full text[sb]");
      }
    }
  });

  it("getVerticalFeedConfig returns the correct config by domainKey", () => {
    const cfg = getVerticalFeedConfig("protein_supplement");
    expect(cfg).toBeDefined();
    expect(cfg?.displayName).toBe("Protein Supplements");
  });

  it("getVerticalFeedConfig returns undefined for unknown key", () => {
    expect(getVerticalFeedConfig("nonexistent_key")).toBeUndefined();
  });

  it("all domainKeys are unique", () => {
    const keys = VERTICAL_FEED_CONFIGS.map((v) => v.domainKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

// ─── manusOrchestrator tests ──────────────────────────────────────────────────

describe("buildVerticalAgentPrompt", () => {
  const prompt = buildVerticalAgentPrompt({
    taskId: "test-task-001",
    vertical: "protein_supplement",
    coordBaseUrl: "https://example.manus.space",
    coordApiKey: "test-key-abc",
    maxItems: 15,
  });

  it("includes the taskId", () => {
    expect(prompt).toContain("test-task-001");
  });

  it("includes the vertical name", () => {
    expect(prompt).toContain("protein_supplement");
  });

  it("includes the coord base URL", () => {
    expect(prompt).toContain("https://example.manus.space/api/coord");
  });

  it("includes the coord API key", () => {
    expect(prompt).toContain("test-key-abc");
  });

  it("includes the maxItems limit", () => {
    expect(prompt).toContain("15");
  });

  it("includes all required coordination endpoints", () => {
    expect(prompt).toContain("/api/coord/tasks/register");
    expect(prompt).toContain("/api/coord/queue/dequeue");
    expect(prompt).toContain("/api/coord/queue/complete");
    expect(prompt).toContain("/api/coord/tasks/heartbeat");
    expect(prompt).toContain("/api/coord/tasks/complete");
  });
});

// ─── coordApi tests ───────────────────────────────────────────────────────────

describe("createCoordRouter", () => {
  it("returns an Express router without throwing", () => {
    const router = createCoordRouter();
    expect(router).toBeDefined();
    // Express routers are functions
    expect(typeof router).toBe("function");
  });

  it("router has expected route stack entries", () => {
    const router = createCoordRouter();
    // Express router exposes .stack with registered layers
    const stack = (router as unknown as { stack: Array<{ route?: { path: string } }> }).stack;
    const paths = stack
      .filter((l) => l.route)
      .map((l) => l.route!.path);

    expect(paths).toContain("/queue/dequeue");
    expect(paths).toContain("/queue/complete");
    expect(paths).toContain("/queue/fail");
    expect(paths).toContain("/tasks/register");
    expect(paths).toContain("/tasks/heartbeat");
    expect(paths).toContain("/tasks/complete");
    expect(paths).toContain("/tasks/fail");
    // Context routes use :key(*) wildcard pattern
    expect(paths.some((p: string) => p.startsWith("/context"))).toBe(true);
  });
});
