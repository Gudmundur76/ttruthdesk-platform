/**
 * verticalFeedConfig.test.ts
 * Unit tests for server/verticalFeedConfig.ts
 * Pure data + pure function — no mocks needed.
 */
import { describe, it, expect } from "vitest";
import { VERTICAL_FEED_CONFIGS, getVerticalFeedConfig } from "./verticalFeedConfig";

describe("VERTICAL_FEED_CONFIGS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(VERTICAL_FEED_CONFIGS)).toBe(true);
    expect(VERTICAL_FEED_CONFIGS.length).toBeGreaterThan(0);
  });

  it("every config has required fields", () => {
    for (const cfg of VERTICAL_FEED_CONFIGS) {
      expect(typeof cfg.domainKey).toBe("string");
      expect(cfg.domainKey.length).toBeGreaterThan(0);
      expect(typeof cfg.displayName).toBe("string");
      expect(Array.isArray(cfg.meshQueries)).toBe(true);
      expect(cfg.meshQueries.length).toBeGreaterThan(0);
      expect(typeof cfg.maxResultsPerQuery).toBe("number");
      expect(cfg.maxResultsPerQuery).toBeGreaterThan(0);
    }
  });

  it("all meshQueries include 'free full text[sb]' (PMC Open Access filter)", () => {
    for (const cfg of VERTICAL_FEED_CONFIGS) {
      for (const q of cfg.meshQueries) {
        expect(q).toContain("free full text[sb]");
      }
    }
  });

  it("all domainKeys are unique", () => {
    const keys = VERTICAL_FEED_CONFIGS.map((c) => c.domainKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("structural_biology config exists", () => {
    const cfg = VERTICAL_FEED_CONFIGS.find((c) => c.domainKey === "structural_biology");
    expect(cfg).toBeDefined();
    expect(cfg!.meshQueries.length).toBeGreaterThan(0);
  });
});

describe("getVerticalFeedConfig()", () => {
  it("returns config for known domainKey", () => {
    const cfg = getVerticalFeedConfig("structural_biology");
    expect(cfg).toBeDefined();
    expect(cfg!.domainKey).toBe("structural_biology");
  });

  it("returns undefined for unknown domainKey", () => {
    const cfg = getVerticalFeedConfig("unknown_domain_xyz");
    expect(cfg).toBeUndefined();
  });

  it("returns config for each registered domainKey", () => {
    for (const registered of VERTICAL_FEED_CONFIGS) {
      const found = getVerticalFeedConfig(registered.domainKey);
      expect(found).toBeDefined();
      expect(found!.domainKey).toBe(registered.domainKey);
    }
  });
});
