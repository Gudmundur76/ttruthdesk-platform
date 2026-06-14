/**
 * trainingCorpusListener.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db");
vi.mock("./claimProvenanceService");
vi.mock("./logger", () => ({
  logger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("buildTrainingPayload", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns null when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);
    const { buildTrainingPayload } = await import("./trainingCorpusListener");
    expect(await buildTrainingPayload(1, "Supported")).toBeNull();
  });

  it("returns null when claim is not found", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);
    const { buildTrainingPayload } = await import("./trainingCorpusListener");
    expect(await buildTrainingPayload(999, "Supported")).toBeNull();
  });

  it("returns a valid payload with all required fields", async () => {
    const { getDb } = await import("./db");
    const { getChain } = await import("./claimProvenanceService");
    const mockClaim = {
      id: 42,
      claimText: "The protein 1LYZ is a lysozyme.",
      confidenceScore: 0.92,
      sourcePassage: "Lysozyme (PDB: 1LYZ) was crystallised at 1.8Å.",
      pdbId: "1LYZ",
      proteinName: "Lysozyme",
      organism: "Gallus gallus",
      ligand: null,
      experimentalMethod: "X-ray crystallography",
    };
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockClaim]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);
    vi.mocked(getChain).mockResolvedValue([
      {
        id: 1,
        claimId: 42,
        documentId: 10,
        step: "evidence_lookup",
        actor: "pdb_adapter",
        inputSnapshot: null,
        outputSnapshot: null,
        durationMs: 120,
        success: true,
        errorMsg: null,
        createdAt: new Date(),
      },
    ]);
    const { buildTrainingPayload } = await import("./trainingCorpusListener");
    const result = await buildTrainingPayload(42, "Supported");
    expect(result).not.toBeNull();
    expect(result!.claimId).toBe(42);
    expect(result!.verdict).toBe("Supported");
    expect(result!.confidence).toBe(0.92);
    expect(result!.entities).toContain("1LYZ");
    expect(result!.entities).toContain("Lysozyme");
    expect(result!.provenance).toContain("evidence_lookup");
  });

  it("uses claimText as contextSentence when sourcePassage is null", async () => {
    const { getDb } = await import("./db");
    const { getChain } = await import("./claimProvenanceService");
    const mockClaim = {
      id: 7,
      claimText: "Actin forms filaments.",
      confidenceScore: 0.3,
      sourcePassage: null,
      pdbId: null,
      proteinName: "Actin",
      organism: null,
      ligand: null,
      experimentalMethod: null,
    };
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockClaim]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);
    vi.mocked(getChain).mockResolvedValue([]);
    const { buildTrainingPayload } = await import("./trainingCorpusListener");
    const result = await buildTrainingPayload(7, "Contradicted");
    expect(result!.contextSentence).toBe("Actin forms filaments.");
    expect(result!.provenance).toBe("");
  });

  it("uses default confidence of 0.5 when confidenceScore is null", async () => {
    const { getDb } = await import("./db");
    const { getChain } = await import("./claimProvenanceService");
    const mockClaim = {
      id: 3,
      claimText: "Some claim.",
      confidenceScore: null,
      sourcePassage: null,
      pdbId: null,
      proteinName: null,
      organism: null,
      ligand: null,
      experimentalMethod: null,
    };
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockClaim]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);
    vi.mocked(getChain).mockResolvedValue([]);
    const { buildTrainingPayload } = await import("./trainingCorpusListener");
    const result = await buildTrainingPayload(3, "Ambiguous");
    expect(result!.confidence).toBe(0.5);
  });
});

describe("notifyTrainingCorpus", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env["TRAINING_CORPUS_ENABLED"];
  });

  it("resolves without throwing when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValue(null as never);
    const { notifyTrainingCorpus } = await import("./trainingCorpusListener");
    await expect(notifyTrainingCorpus(1, "Supported")).resolves.toBeUndefined();
  });

  it("resolves without throwing when TRAINING_CORPUS_ENABLED is not set", async () => {
    const { getDb } = await import("./db");
    const mockClaim = {
      id: 1,
      claimText: "Test claim.",
      confidenceScore: 0.8,
      sourcePassage: null,
      pdbId: null,
      proteinName: null,
      organism: null,
      ligand: null,
      experimentalMethod: null,
    };
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockClaim]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as never);
    const { notifyTrainingCorpus } = await import("./trainingCorpusListener");
    await expect(notifyTrainingCorpus(1, "Supported")).resolves.toBeUndefined();
  });

  it("never throws even when an internal error occurs", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockRejectedValue(new Error("DB connection failed"));
    const { notifyTrainingCorpus } = await import("./trainingCorpusListener");
    await expect(notifyTrainingCorpus(1, "Supported")).resolves.toBeUndefined();
  });
});
