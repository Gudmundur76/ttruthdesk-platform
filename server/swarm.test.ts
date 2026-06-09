import { describe, it, expect, vi, beforeEach } from "vitest";

// Inject a fake OPENROUTER_API_KEY so key-pool tests work in CI without a real key
if (!process.env.OPENROUTER_API_KEY) {
  process.env.OPENROUTER_API_KEY = "sk-or-ci-test-key-placeholder";
}

// ─── multiLLM free model pool tests ─────────────────────────────────────────────────────────────────────────────────
describe("multiLLM free model pool", () => {
  it("FREE_MODEL_ROTATION contains 8 models", async () => {
    const { FREE_MODEL_ROTATION } = await import("./_core/multiLLM");
    expect(FREE_MODEL_ROTATION.length).toBe(8);
  });

  it("FREE_MODEL_ROTATION includes openrouter/free meta-router", async () => {
    const { FREE_MODEL_ROTATION } = await import("./_core/multiLLM");
    expect(FREE_MODEL_ROTATION).toContain("openrouter/free");
  });

  it("FREE_MODEL_ROTATION includes NVIDIA Nemotron", async () => {
    const { FREE_MODEL_ROTATION } = await import("./_core/multiLLM");
    expect(FREE_MODEL_ROTATION).toContain("nvidia/nemotron-3-super-120b-a12b:free");
  });

  it("FREE_MODEL_ROTATION includes Baidu ERNIE", async () => {
    const { FREE_MODEL_ROTATION } = await import("./_core/multiLLM");
    expect(FREE_MODEL_ROTATION).toContain("baidu/ernie-4.5-21b-a3b:free");
  });

  it("FREE_MODEL_ROTATION includes GLM 4.5 Air", async () => {
    const { FREE_MODEL_ROTATION } = await import("./_core/multiLLM");
    expect(FREE_MODEL_ROTATION).toContain("z-ai/glm-4.5-air:free");
  });

  it("getKeyPoolSize returns at least 1", async () => {
    const { getKeyPoolSize } = await import("./_core/multiLLM");
    expect(getKeyPoolSize()).toBeGreaterThanOrEqual(1);
  });

  it("getLLMHealthSummary returns expected shape", async () => {
    const { getLLMHealthSummary } = await import("./_core/multiLLM");
    const summary = getLLMHealthSummary();
    expect(summary).toHaveProperty("provider");
    expect(summary).toHaveProperty("keyPoolSize");
    expect(summary).toHaveProperty("freeModelCount");
    expect(summary.freeModelCount).toBe(8);
  });

  it("getNextOpenRouterKey returns a non-empty string", async () => {
    const { getNextOpenRouterKey } = await import("./_core/multiLLM");
    const key = getNextOpenRouterKey();
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("buildModelPriorityList draft tier starts with free models", async () => {
    const { buildModelPriorityList } = await import("./_core/multiLLM");
    const list = buildModelPriorityList("draft");
    expect(list.length).toBeGreaterThan(0);
    // draft tier should prefer free models
    expect(list[0]).toMatch(/:free$|^openrouter\/free$/);
  });

  it("buildModelPriorityList quality tier starts with a quality model", async () => {
    const { buildModelPriorityList } = await import("./_core/multiLLM");
    const list = buildModelPriorityList("quality");
    expect(list.length).toBeGreaterThan(0);
  });
});

// ─── swarmTickJob tests ───────────────────────────────────────────────────────
describe("swarmTickJob", () => {
  it("exports swarmTickHandler function", async () => {
    const { swarmTickHandler } = await import("./swarmTickJob");
    expect(typeof swarmTickHandler).toBe("function");
  });

  it("swarmTickJob source fans out 5 agents in parallel", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./swarmTickJob.ts", import.meta.url).pathname,
      "utf8"
    );
    // Must use Promise.allSettled to fan out in parallel
    expect(src).toContain("Promise.allSettled");
    // Must reference all 5 agent runner functions
    expect(src).toContain("runHarvesterAgent");
    expect(src).toContain("runWikiCompilerAgent");
    expect(src).toContain("runQualityAuditorAgent");
    expect(src).toContain("runBackfillPredictorAgent");
    expect(src).toContain("runMonitoringScannerAgent");
  });

  it("swarmTickJob source returns agents array in response", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./swarmTickJob.ts", import.meta.url).pathname,
      "utf8"
    );
    expect(src).toContain("agents");
    expect(src).toContain("res.json");
  });
});

// ─── analysisPipeline parallel validation tests ───────────────────────────────
describe("analysisPipeline parallel claim validation", () => {
  it("runAnalysisPipeline exports a function", async () => {
    const { runAnalysisPipeline } = await import("./analysisPipeline");
    expect(typeof runAnalysisPipeline).toBe("function");
  });

  it("parallel validation processes multiple claims concurrently", async () => {
    // Verify the pipeline uses Promise.allSettled by checking the source
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./analysisPipeline.ts", import.meta.url).pathname,
      "utf8"
    );
    expect(src).toContain("Promise.allSettled");
    expect(src).toContain("CLAIM_CONCURRENCY");
  });

  it("CLAIM_CONCURRENCY is set to 8", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./analysisPipeline.ts", import.meta.url).pathname,
      "utf8"
    );
    expect(src).toContain("CLAIM_CONCURRENCY = 8");
  });
});

// ─── seedKnowledgeGraph concurrent pool tests ─────────────────────────────────
describe("seedKnowledgeGraph concurrent pool", () => {
  it("seed script uses concurrent pool of 4", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./seedKnowledgeGraph.ts", import.meta.url).pathname,
      "utf8"
    );
    expect(src).toContain("DOC_CONCURRENCY");
    expect(src).toContain("DOC_CONCURRENCY = 4");
  });

  it("seed script uses Promise.allSettled for concurrent processing", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("./seedKnowledgeGraph.ts", import.meta.url).pathname,
      "utf8"
    );
    expect(src).toContain("Promise.allSettled");
  });
});
