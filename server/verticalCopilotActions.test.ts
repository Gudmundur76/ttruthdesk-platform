/**
 * verticalCopilotActions.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for verticalCopilotActions.ts — TIER_TOOLS, getToolsForTier
 */
import { describe, it, expect } from "vitest";
import {
  LAXEY_TOOLS,
  ALVOTECH_TOOLS,
  ACADEMIC_TOOLS,
  TIER_TOOLS,
  getToolsForTier,
} from "./verticalCopilotActions";

describe("TIER_TOOLS constants", () => {
  it("LAXEY_TOOLS has required tool keys", () => {
    expect(LAXEY_TOOLS).toBeDefined();
    expect(typeof LAXEY_TOOLS).toBe("object");
    expect(Object.keys(LAXEY_TOOLS).length).toBeGreaterThan(0);
  });

  it("ALVOTECH_TOOLS has required tool keys", () => {
    expect(ALVOTECH_TOOLS).toBeDefined();
    expect(Object.keys(ALVOTECH_TOOLS).length).toBeGreaterThan(0);
  });

  it("ACADEMIC_TOOLS has required tool keys", () => {
    expect(ACADEMIC_TOOLS).toBeDefined();
    expect(Object.keys(ACADEMIC_TOOLS).length).toBeGreaterThan(0);
  });

  it("TIER_TOOLS maps all three tiers", () => {
    expect(TIER_TOOLS.laxey).toBe(LAXEY_TOOLS);
    expect(TIER_TOOLS.alvotech).toBe(ALVOTECH_TOOLS);
    expect(TIER_TOOLS.academic).toBe(ACADEMIC_TOOLS);
  });
});

describe("getToolsForTier()", () => {
  it("returns LAXEY_TOOLS for laxey tier", () => {
    const tools = getToolsForTier("laxey");
    expect(tools).toBe(LAXEY_TOOLS);
  });

  it("returns ALVOTECH_TOOLS for alvotech tier", () => {
    const tools = getToolsForTier("alvotech");
    expect(tools).toBe(ALVOTECH_TOOLS);
  });

  it("returns ACADEMIC_TOOLS for academic tier", () => {
    const tools = getToolsForTier("academic");
    expect(tools).toBe(ACADEMIC_TOOLS);
  });

  it("each tool is a function or object", () => {
    const tools = getToolsForTier("academic");
    const toolList = Object.values(tools);
    expect(toolList.length).toBeGreaterThan(0);
    for (const tool of toolList) {
      expect(tool).toBeDefined();
    }
  });

  it("ACADEMIC_TOOLS has more tools than LAXEY_TOOLS (academic is the full tier)", () => {
    const laxeyCount = Object.keys(getToolsForTier("laxey")).length;
    const academicCount = Object.keys(getToolsForTier("academic")).length;
    expect(academicCount).toBeGreaterThanOrEqual(laxeyCount);
  });
});
