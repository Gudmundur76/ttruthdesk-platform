/**
 * modelRouter.test.ts
 * Full coverage of ModelRouter.route() — all 5 routing rules, env-gate,
 * confidence threshold, domain support, and singleton.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
const { mockVerify, mockIsHealthy, mockSupportsDomain, mockGetLocalClaimVerifier } =
  vi.hoisted(() => {
    const mockVerify = vi.fn();
    const mockIsHealthy = vi.fn();
    const mockSupportsDomain = vi.fn();
    const mockGetLocalClaimVerifier = vi.fn(() => ({
      isHealthy: mockIsHealthy,
      supportsDomain: mockSupportsDomain,
      verify: mockVerify,
    }));
    return { mockVerify, mockIsHealthy, mockSupportsDomain, mockGetLocalClaimVerifier };
  });

vi.mock("./inference/claimVerifier", () => ({
  getLocalClaimVerifier: mockGetLocalClaimVerifier,
}));

vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { ModelRouter, getModelRouter } from "./modelRouter";

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("ModelRouter.route() — Rule 1: LOCAL_MODEL_ENABLED=false", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes to orchestrated_pipeline when LOCAL_MODEL_ENABLED=false", async () => {
    vi.resetModules();
    process.env["LOCAL_MODEL_ENABLED"] = "false";
    // Re-import after env change
    const { ModelRouter: MR } = await import("./modelRouter");
    const router = new MR();
    const result = await router.route("Metformin activates AMPK");
    expect(result.decision).toBe("orchestrated_pipeline");
    expect(result.reason).toContain("LOCAL_MODEL_ENABLED=false");
    delete process.env["LOCAL_MODEL_ENABLED"];
  });
});

describe("ModelRouter.route() — Rule 2: local model unhealthy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["LOCAL_MODEL_ENABLED"] = "true";
  });

  it("routes to orchestrated_pipeline when local model is not healthy", async () => {
    mockIsHealthy.mockResolvedValue(false);
    const router = new ModelRouter();
    const result = await router.route("Aspirin reduces fever");
    expect(result.decision).toBe("orchestrated_pipeline");
    expect(result.reason).toBe("local_model_unavailable");
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe("ModelRouter.route() — Rule 3: domain not supported", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["LOCAL_MODEL_ENABLED"] = "true";
    mockIsHealthy.mockResolvedValue(true);
  });

  it("routes to orchestrated_pipeline when domain is not supported", async () => {
    mockSupportsDomain.mockReturnValue(false);
    const router = new ModelRouter();
    const result = await router.route("Some claim", "unsupported-domain");
    expect(result.decision).toBe("orchestrated_pipeline");
    expect(result.reason).toContain("domain_not_supported");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("includes the domain name in the reason", async () => {
    mockSupportsDomain.mockReturnValue(false);
    const router = new ModelRouter();
    const result = await router.route("Some claim", "astrophysics");
    expect(result.reason).toContain("astrophysics");
  });

  it("uses 'unknown' when domain is undefined", async () => {
    mockSupportsDomain.mockReturnValue(false);
    const router = new ModelRouter();
    const result = await router.route("Some claim");
    expect(result.reason).toContain("unknown");
  });
});

describe("ModelRouter.route() — Rule 4: confidence below threshold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["LOCAL_MODEL_ENABLED"] = "true";
    process.env["LOCAL_MODEL_CONFIDENCE_THRESHOLD"] = "0.6";
    mockIsHealthy.mockResolvedValue(true);
    mockSupportsDomain.mockReturnValue(true);
  });

  it("escalates when local model confidence is below threshold", async () => {
    mockVerify.mockResolvedValue({ verdict: "Insufficient", confidence: 0.4 });
    const router = new ModelRouter();
    const result = await router.route("Weak claim", "pharmacology");
    expect(result.decision).toBe("escalate");
    expect(result.localResult).toBeDefined();
    expect(result.localResult?.confidence).toBe(0.4);
    expect(result.reason).toContain("confidence_below_threshold");
  });

  it("includes the actual confidence value in the reason", async () => {
    mockVerify.mockResolvedValue({ verdict: "Insufficient", confidence: 0.35 });
    const router = new ModelRouter();
    const result = await router.route("Weak claim");
    expect(result.reason).toContain("0.35");
  });
});

describe("ModelRouter.route() — Rule 5: local model confident", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["LOCAL_MODEL_ENABLED"] = "true";
    process.env["LOCAL_MODEL_CONFIDENCE_THRESHOLD"] = "0.6";
    mockIsHealthy.mockResolvedValue(true);
    mockSupportsDomain.mockReturnValue(true);
  });

  it("returns local_model decision when confidence meets threshold", async () => {
    mockVerify.mockResolvedValue({ verdict: "Supported", confidence: 0.9 });
    const router = new ModelRouter();
    const result = await router.route("Strong claim", "pharmacology");
    expect(result.decision).toBe("local_model");
    expect(result.localResult?.verdict).toBe("Supported");
    expect(result.reason).toBe("local_model_confident");
  });

  it("returns local_model when confidence exactly equals threshold", async () => {
    mockVerify.mockResolvedValue({ verdict: "Supported", confidence: 0.6 });
    const router = new ModelRouter();
    const result = await router.route("Borderline claim");
    expect(result.decision).toBe("local_model");
  });

  it("passes claimText and domain to verifier.verify()", async () => {
    mockVerify.mockResolvedValue({ verdict: "Supported", confidence: 0.95 });
    const router = new ModelRouter();
    await router.route("BRCA1 mutation increases cancer risk", "oncology");
    expect(mockVerify).toHaveBeenCalledWith(
      "BRCA1 mutation increases cancer risk",
      "oncology"
    );
  });
});

describe("getModelRouter() singleton", () => {
  it("returns the same instance on repeated calls", async () => {
    vi.resetModules();
    const { getModelRouter: gmr } = await import("./modelRouter");
    const a = gmr();
    const b = gmr();
    expect(a).toBe(b);
  });
});
