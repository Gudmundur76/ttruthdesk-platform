/**
 * citationSearchRoute.test.ts — Sprint 29
 *
 * Tests for GET /api/citation-search/stream
 *
 * Strategy: test logic in isolation (rate limiting, input validation,
 * SSE helpers, verdict logic) and integration via supertest OPTIONS preflight.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("./questionDecomposer", () => ({
  decomposeQuestion: vi.fn().mockResolvedValue({
    input: "does creatine improve performance",
    claims: [
      {
        text: "creatine improves athletic performance",
        confidence: 0.9,
        method: "heuristic",
        index: 0,
      },
    ],
    durationMs: 5,
    usedLlm: false,
  }),
}));

vi.mock("./domainClassifier", () => ({
  classifyClaims: vi.fn().mockReturnValue([
    {
      claim: {
        text: "creatine improves athletic performance",
        confidence: 0.9,
        method: "heuristic",
        index: 0,
      },
      routes: [
        { sourceId: "pubmed", confidence: 0.8, reason: "biomedical claim" },
      ],
      domain: "biomedical_general",
      durationMs: 1,
    },
  ]),
  getAllSourceIds: vi.fn().mockReturnValue(["pubmed"]),
}));

vi.mock("./verticalAdapters/types", () => ({
  listVerticals: vi.fn().mockReturnValue([
    {
      domainKey: "openalex",
      lookupEvidence: vi.fn().mockResolvedValue({
        found: true,
        confidenceScore: 0.85,
        sourceId: "openalex:W12345",
        sourceUrl: "https://openalex.org/W12345",
        confidenceFlags: [],
        evidenceRaw: {
          title: "Creatine supplementation and performance",
          journal: "Journal of Sports Science",
          year: 2022,
          abstractSnippet:
            "Creatine significantly improves high-intensity exercise performance.",
        },
      }),
    },
    {
      domainKey: "semantic_scholar",
      lookupEvidence: vi.fn().mockResolvedValue({
        found: false,
        confidenceScore: 0,
        sourceId: null,
        sourceUrl: null,
        confidenceFlags: ["no results"],
        evidenceRaw: null,
      }),
    },
    {
      domainKey: "crossref",
      lookupEvidence: vi.fn().mockResolvedValue({
        found: true,
        confidenceScore: 0.75,
        sourceId: "crossref:10.1234/test",
        sourceUrl: "https://doi.org/10.1234/test",
        confidenceFlags: [],
        evidenceRaw: {
          title: "Effects of creatine on muscle strength",
          journal: "Nutrition Research",
          year: 2021,
          abstractSnippet:
            "Meta-analysis confirms creatine supplementation increases muscle strength.",
        },
      }),
    },
  ]),
  getVertical: vi.fn().mockReturnValue(null),
}));

vi.mock("./verticalAdapters", () => ({}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content:
            "Creatine supplementation is supported by multiple studies [1][3].",
        },
      },
    ],
  }),
}));

vi.mock("./autonomousIngest", () => ({
  triggerAutonomousIngest: vi.fn(),
}));

vi.mock("./apiKeyService", () => ({
  validateApiKey: vi.fn().mockResolvedValue({ valid: false }),
}));

// ─── Import after mocks ────────────────────────────────────────────────────────
import { registerCitationSearchRoute } from "./citationSearchRoute";

function buildApp() {
  const app = express();
  registerCitationSearchRoute(app);
  return app;
}

async function getSSEBody(q: string): Promise<string> {
  const app = buildApp();
  const res = await request(app)
    .get(`/api/citation-search/stream?q=${encodeURIComponent(q)}`)
    .buffer(true)
    .parse((res, callback) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => callback(null, data));
    });
  // When using a custom parser, supertest stores the result in res.body, not res.text
  return (res.body as string) ?? "";
}

function parseSSEEvents(body: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const lines = body.split("\n");
  let currentEvent = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ") && currentEvent) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) });
      } catch {
        /* ignore */
      }
      currentEvent = "";
    }
  }
  return events;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("citationSearchRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("OPTIONS preflight", () => {
    it("returns 204 with CORS headers", async () => {
      const app = buildApp();
      const res = await request(app).options("/api/citation-search/stream");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-methods"]).toContain("GET");
    });
  });

  describe("Input validation", () => {
    it("returns 400 when q is missing", async () => {
      const app = buildApp();
      const res = await request(app).get("/api/citation-search/stream");
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/required/i);
    });

    it("returns 400 when q is too short", async () => {
      const app = buildApp();
      const res = await request(app).get("/api/citation-search/stream?q=ab");
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it("returns 400 when q exceeds 2000 chars", async () => {
      const app = buildApp();
      const longQ = "a".repeat(2001);
      const res = await request(app).get(
        `/api/citation-search/stream?q=${longQ}`
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/too long/i);
    });

    it("accepts a valid q and returns SSE content-type", async () => {
      const app = buildApp();
      const res = await request(app)
        .get("/api/citation-search/stream?q=does+creatine+improve+performance")
        .buffer(true)
        .parse((res, callback) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => callback(null, data));
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    });
  });

  describe("Rate limiting", () => {
    it("does not rate-limit under the threshold", async () => {
      const app = buildApp();
      const res = await request(app).get(
        "/api/citation-search/stream?q=test+query+here"
      );
      expect(res.status).not.toBe(429);
    });

    it("includes X-RateLimit-Remaining header", async () => {
      const app = buildApp();
      const res = await request(app)
        .get("/api/citation-search/stream?q=does+creatine+improve+performance")
        .buffer(true)
        .parse((res, callback) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => callback(null, data));
        });
      expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    });
  });

  describe("SSE event shape", () => {
    it("emits stage:decompose as first named event", async () => {
      const body = await getSSEBody("does creatine improve performance");
      const events = parseSSEEvents(body);
      const decompose = events.find(e => e.event === "stage:decompose");
      expect(decompose).toBeDefined();
      const d = decompose!.data as Record<string, unknown>;
      expect(d.stage).toBe(1);
      expect(d.label).toBe("decompose");
      expect(d.question).toBe("does creatine improve performance");
      expect(Array.isArray(d.claims)).toBe(true);
    });

    it("emits stage:evidence with totalAdapters and sourcesFound", async () => {
      const body = await getSSEBody("does creatine improve performance");
      const events = parseSSEEvents(body);
      const evidence = events.find(e => e.event === "stage:evidence");
      expect(evidence).toBeDefined();
      const d = evidence!.data as Record<string, unknown>;
      expect(d.stage).toBe(2);
      expect(d.label).toBe("evidence");
      expect(typeof d.totalAdapters).toBe("number");
      expect(typeof d.sourcesFound).toBe("number");
      expect(Array.isArray(d.sources)).toBe(true);
    });

    it("emits stage:answer with verdict and confidence", async () => {
      const body = await getSSEBody("does creatine improve performance");
      const events = parseSSEEvents(body);
      const answer = events.find(e => e.event === "stage:answer");
      expect(answer).toBeDefined();
      const d = answer!.data as Record<string, unknown>;
      expect(d.stage).toBe(3);
      expect(d.label).toBe("answer");
      expect(typeof d.verdict).toBe("string");
      expect(typeof d.confidence).toBe("number");
    });

    it("emits final event with ok:true and all required fields", async () => {
      const body = await getSSEBody("does creatine improve performance");
      const events = parseSSEEvents(body);
      const final = events.find(e => e.event === "final");
      expect(final).toBeDefined();
      const d = final!.data as Record<string, unknown>;
      expect(d.ok).toBe(true);
      expect(typeof d.question).toBe("string");
      expect(typeof d.primaryClaim).toBe("string");
      expect(typeof d.answer).toBe("string");
      expect(typeof d.verdict).toBe("string");
      expect(typeof d.confidence).toBe("number");
      expect(Array.isArray(d.sources)).toBe(true);
      expect(d.apiVersion).toBe("2.0");
      expect(d.streaming).toBe(true);
    });

    it("emits events in correct order: decompose → evidence → answer → final", async () => {
      const body = await getSSEBody("does creatine improve performance");
      const events = parseSSEEvents(body);
      const names = events.map(e => e.event);
      const di = names.indexOf("stage:decompose");
      const ei = names.indexOf("stage:evidence");
      const ai = names.indexOf("stage:answer");
      const fi = names.indexOf("final");
      expect(di).toBeGreaterThanOrEqual(0);
      expect(ei).toBeGreaterThan(di);
      expect(ai).toBeGreaterThan(ei);
      expect(fi).toBeGreaterThan(ai);
    });
  });

  describe("Verdict logic", () => {
    it("returns Supported verdict when high-confidence evidence found", async () => {
      const body = await getSSEBody("does creatine improve performance");
      const events = parseSSEEvents(body);
      const final = events.find(e => e.event === "final");
      const d = final!.data as Record<string, unknown>;
      expect(d.verdict).toBe("Supported");
      expect(d.confidence as number).toBeGreaterThan(0.5);
    });

    it("final event sources array contains adapterKey and sourceUrl", async () => {
      const body = await getSSEBody("does creatine improve performance");
      const events = parseSSEEvents(body);
      const final = events.find(e => e.event === "final");
      const d = final!.data as Record<string, unknown>;
      const sources = d.sources as Array<Record<string, unknown>>;
      expect(sources.length).toBeGreaterThan(0);
      expect(typeof sources[0].adapterKey).toBe("string");
      expect(typeof sources[0].sourceUrl).toBe("string");
    });
  });

  describe("Autonomous ingest side effect", () => {
    it("calls triggerAutonomousIngest when sources are found", async () => {
      const { triggerAutonomousIngest } = await import("./autonomousIngest");
      await getSSEBody("does creatine improve performance");
      expect(triggerAutonomousIngest).toHaveBeenCalledOnce();
      const callArg = (triggerAutonomousIngest as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(callArg.query).toBe("does creatine improve performance");
    });
  });

  describe("LLM answer synthesis", () => {
    it("final event answer field contains synthesised text", async () => {
      const body = await getSSEBody("does creatine improve performance");
      const events = parseSSEEvents(body);
      const final = events.find(e => e.event === "final");
      const d = final!.data as Record<string, unknown>;
      expect(typeof d.answer).toBe("string");
      expect((d.answer as string).length).toBeGreaterThan(10);
    });
  });
});
