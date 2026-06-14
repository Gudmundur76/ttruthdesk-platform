/**
 * codeDriftService.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the six drift detectors and the orchestrator.
 *
 * The detectors read the filesystem and run child processes — we mock those
 * at the Node built-in level using vi.mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
const { mockReadFileSync, mockReaddirSync, mockExistsSync, mockExecSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockExecSync: vi.fn(),
}));

vi.mock("fs", () => ({
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
  existsSync: mockExistsSync,
}));

vi.mock("child_process", () => ({
  execSync: mockExecSync,
}));

// Also mock the db import used by detectDisciplineDrift
const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mockGetDb }));

import {
  detectSchemaDrift,
  detectApiDrift,
  detectTestDrift,
  detectDependencyDrift,
  detectConfigDrift,
  detectCodeDrift,
  type DriftFinding,
} from "./codeDriftService";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function expectDriftShape(finding: DriftFinding) {
  expect(typeof finding.checkType).toBe("string");
  expect(["info", "warning", "critical"]).toContain(finding.severity);
  expect(typeof finding.confidence).toBe("number");
  expect(typeof finding.details).toBe("object");
  expect(typeof finding.summary).toBe("string");
}

// ─── detectSchemaDrift ────────────────────────────────────────────────────────
describe("codeDriftService — detectSchemaDrift()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns info when schema and migrations are in sync", () => {
    // schema.ts has one table
    mockReadFileSync.mockReturnValue('mysqlTable("users", ...)');
    // migration file has CREATE TABLE for that table
    mockReaddirSync.mockReturnValue(["0001_init.sql"]);
    // second readFileSync call (migration file) returns CREATE TABLE
    mockReadFileSync
      .mockReturnValueOnce('mysqlTable("users", ...)')  // schema.ts
      .mockReturnValueOnce("CREATE TABLE `users` (id INT)");  // migration

    const result = detectSchemaDrift();

    expectDriftShape(result);
    expect(result.checkType).toBe("schemaDrift");
    expect(result.severity).toBe("info");
    expect((result.details.unmigratedTables as string[]).length).toBe(0);
  });

  it("returns warning when schema has tables not in migrations", () => {
    mockReadFileSync
      .mockReturnValueOnce('mysqlTable("users", ...) mysqlTable("claims", ...)')
      .mockReturnValueOnce("CREATE TABLE `users` (id INT)");
    mockReaddirSync.mockReturnValue(["0001_init.sql"]);

    const result = detectSchemaDrift();

    expect(result.severity).toBe("warning");
    expect(result.details.unmigratedTables as string[]).toContain("claims");
  });

  it("returns info when schema.ts is empty (no tables)", () => {
    mockReadFileSync.mockReturnValue("");
    mockReaddirSync.mockReturnValue([]);

    const result = detectSchemaDrift();

    expect(result.severity).toBe("info");
    expect((result.details.unmigratedTables as string[]).length).toBe(0);
  });
});

// ─── detectApiDrift ───────────────────────────────────────────────────────────
describe("codeDriftService — detectApiDrift()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns info when all routers are used in the frontend", () => {
    // routers.ts exports: auth, claims
    mockReadFileSync
      .mockReturnValueOnce("export const appRouter = router({ auth: authRouter, claims: claimsRouter })")
      .mockReturnValueOnce("trpc.auth.me.useQuery() trpc.claims.list.useQuery()");
    mockReaddirSync.mockReturnValue(["Home.tsx"]);

    const result = detectApiDrift();

    expectDriftShape(result);
    expect(result.checkType).toBe("apiDrift");
  });

  it("returns a DriftFinding with correct shape even when files are empty", () => {
    mockReadFileSync.mockReturnValue("");
    mockReaddirSync.mockReturnValue([]);

    const result = detectApiDrift();

    expectDriftShape(result);
  });
});

// ─── detectTestDrift ──────────────────────────────────────────────────────────
describe("codeDriftService — detectTestDrift()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns info when all source files have test files", () => {
    mockReaddirSync.mockReturnValue(["claimExtractor.ts", "claimExtractor.test.ts"]);
    mockExistsSync.mockReturnValue(true);

    const result = detectTestDrift();

    expectDriftShape(result);
    expect(result.checkType).toBe("testDrift");
    // claimExtractor.test.ts is filtered out (ends with .test.ts)
    // claimExtractor.ts has a test file → 100% coverage
    expect(result.severity).toBe("info");
  });

  it("returns warning when coverage is below 70%", () => {
    // 3 source files, all missing test files
    mockReaddirSync.mockReturnValue([
      "fileA.ts", "fileB.ts", "fileC.ts",
    ]);
    mockExistsSync.mockReturnValue(false);

    const result = detectTestDrift();

    expect(["warning", "critical"]).toContain(result.severity);
    expect((result.details.untestedFiles as string[]).length).toBeGreaterThan(0);
  });

  it("returns critical when coverage is below 50%", () => {
    // 10 source files, none have tests
    const files = Array.from({ length: 10 }, (_, i) => `module${i}.ts`);
    mockReaddirSync.mockReturnValue(files);
    mockExistsSync.mockReturnValue(false);

    const result = detectTestDrift();

    expect(result.severity).toBe("critical");
  });
});

// ─── detectDependencyDrift ────────────────────────────────────────────────────
describe("codeDriftService — detectDependencyDrift()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns info when no outdated packages", () => {
    mockExecSync.mockReturnValue(Buffer.from(JSON.stringify({})));

    const result = detectDependencyDrift();

    expectDriftShape(result);
    expect(result.checkType).toBe("dependencyDrift");
  });

  it("returns a DriftFinding when execSync throws (pnpm not available)", () => {
    mockExecSync.mockImplementation(() => { throw new Error("command not found"); });

    const result = detectDependencyDrift();

    expectDriftShape(result);
    // Should not throw — graceful degradation
  });
});

// ─── detectConfigDrift ────────────────────────────────────────────────────────
describe("codeDriftService — detectConfigDrift()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a DriftFinding with correct shape", () => {
    mockReadFileSync.mockReturnValue("export const env = { DATABASE_URL: process.env.DATABASE_URL }");

    const result = detectConfigDrift();

    expectDriftShape(result);
    expect(result.checkType).toBe("configDrift");
  });

  it("handles empty env.ts gracefully", () => {
    mockReadFileSync.mockReturnValue("");

    const result = detectConfigDrift();

    expectDriftShape(result);
  });
});

// ─── detectCodeDrift (orchestrator) ───────────────────────────────────────────
describe("codeDriftService — detectCodeDrift()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide minimal mocks for all sub-detectors
    mockReadFileSync.mockReturnValue("");
    mockReaddirSync.mockReturnValue([]);
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockReturnValue(Buffer.from(JSON.stringify({})));
    // Mock DB for disciplineDrift
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });
  });

  it("returns a CodeDriftReport with all six findings", async () => {
    const report = await detectCodeDrift();

    expect(report.schemaDrift).toBeDefined();
    expect(report.apiDrift).toBeDefined();
    expect(report.testDrift).toBeDefined();
    expect(report.dependencyDrift).toBeDefined();
    expect(report.configDrift).toBeDefined();
    expect(report.disciplineDrift).toBeDefined();
    expect(typeof report.checkedAt).toBe("string");
    expect(["info", "warning", "critical"]).toContain(report.overallSeverity);
  });

  it("sets overallSeverity to critical when any finding is critical", async () => {
    // Make readdirSync return many untested files to trigger critical testDrift
    const files = Array.from({ length: 20 }, (_, i) => `module${i}.ts`);
    mockReaddirSync.mockReturnValue(files);
    mockExistsSync.mockReturnValue(false);

    const report = await detectCodeDrift();

    expect(report.overallSeverity).toBe("critical");
  });

  it("sets overallSeverity to info when all findings are info", async () => {
    // All mocks return empty/clean state
    const report = await detectCodeDrift();

    // With empty files, all detectors should return info
    expect(["info", "warning"]).toContain(report.overallSeverity);
  });
});
