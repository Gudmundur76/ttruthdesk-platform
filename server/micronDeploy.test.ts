/**
 * micronDeploy.test.ts
 * Unit tests for server/micronDeploy.ts (pure functions only)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("generateSiteConfig()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns a MicronSiteConfig with correct verticalKey", async () => {
    const { generateSiteConfig } = await import("./micronDeploy");
    const config = generateSiteConfig({
      verticalKey: "structural_biology",
      displayName: "Structural Biology",
      apiBase: "https://api.truthdesk.claims",
    });
    expect(config.verticalKey).toBe("structural_biology");
    expect(config.displayName).toBe("Structural Biology");
    expect(config.apiBase).toBe("https://api.truthdesk.claims");
  });

  it("uses known vertical color for structural_biology", async () => {
    const { generateSiteConfig } = await import("./micronDeploy");
    const config = generateSiteConfig({
      verticalKey: "structural_biology",
      displayName: "Structural Biology",
      apiBase: "https://api.truthdesk.claims",
    });
    expect(config.primaryColor).toBe("#7c3aed");
  });

  it("falls back to default color for unknown vertical", async () => {
    const { generateSiteConfig } = await import("./micronDeploy");
    const config = generateSiteConfig({
      verticalKey: "unknown_vertical",
      displayName: "Unknown",
      apiBase: "https://api.truthdesk.claims",
    });
    expect(config.primaryColor).toBe("#7c3aed");
  });

  it("includes required pages (home, registry, wiki, about)", async () => {
    const { generateSiteConfig } = await import("./micronDeploy");
    const config = generateSiteConfig({
      verticalKey: "gut_microbiome",
      displayName: "Gut Microbiome",
      apiBase: "https://api.truthdesk.claims",
    });
    const templates = config.pages.map((p) => p.template);
    expect(templates).toContain("home");
    expect(templates).toContain("registry");
    expect(templates).toContain("wiki");
    expect(templates).toContain("about");
  });

  it("sets domain when provided", async () => {
    const { generateSiteConfig } = await import("./micronDeploy");
    const config = generateSiteConfig({
      verticalKey: "structural_biology",
      displayName: "Structural Biology",
      domain: "sb.truthdesk.claims",
      apiBase: "https://api.truthdesk.claims",
    });
    expect(config.domain).toBe("sb.truthdesk.claims");
  });

  it("enables rss, llmsTxt, and indexNow by default", async () => {
    const { generateSiteConfig } = await import("./micronDeploy");
    const config = generateSiteConfig({
      verticalKey: "structural_biology",
      displayName: "Structural Biology",
      apiBase: "https://api.truthdesk.claims",
    });
    expect(config.rssEnabled).toBe(true);
    expect(config.llmsTxtEnabled).toBe(true);
    expect(config.indexNowEnabled).toBe(true);
  });
});

describe("generateSiteHtml()", () => {
  it("returns a non-empty HTML string", async () => {
    const { generateSiteConfig, generateSiteHtml } = await import("./micronDeploy");
    const config = generateSiteConfig({
      verticalKey: "structural_biology",
      displayName: "Structural Biology",
      apiBase: "https://api.truthdesk.claims",
    });
    const html = generateSiteHtml(config);
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("includes the display name in the HTML", async () => {
    const { generateSiteConfig, generateSiteHtml } = await import("./micronDeploy");
    const config = generateSiteConfig({
      verticalKey: "gut_microbiome",
      displayName: "Gut Microbiome Science",
      apiBase: "https://api.truthdesk.claims",
    });
    const html = generateSiteHtml(config);
    expect(html).toContain("Gut Microbiome Science");
  });
});
