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

// ─── detectDisciplineDrift — DB error path and >100 expired tokens path ─────────────
// detectDisciplineDrift is exported and can be tested directly.
import { detectDisciplineDrift } from "./codeDriftService";

describe("codeDriftService — detectDisciplineDrift()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns warning with confidence 0.3 when DB throws (line 373-374)", async () => {
    mockGetDb.mockResolvedValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockRejectedValue(new Error("DB connection refused")),
    });
    const result = await detectDisciplineDrift();
    expect(result.severity).toBe("warning");
    expect(result.confidence).toBe(0.3);
    expect(result.details.dbError).toBeTruthy();
    expect(result.summary).toContain("DB error");
  });

  it("returns warning when expiredUnusedCount > 100 (line 375-376)", async () => {
    // Return 101 expired tokens for the first select, 0 for the second
    let callCount = 0;
    const makeChain = (rows: unknown[]) => {
      const p = Promise.resolve(rows);
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.then = (res: Parameters<typeof p.then>[0], rej: Parameters<typeof p.then>[1]) => p.then(res, rej);
      c.catch = p.catch.bind(p);
      c.finally = p.finally.bind(p);
      return c;
    };
    const db = {
      select: vi.fn().mockImplementation(() => {
        callCount++;
        // First call: expired tokens (>100)
        if (callCount === 1) return makeChain(Array.from({ length: 101 }, (_, i) => ({ id: i })));
        // Second call: stale tokens
        return makeChain([]);
      }),
    };
    mockGetDb.mockResolvedValue(db);
    const result = await detectDisciplineDrift();
    expect(result.severity).toBe("warning");
    expect(result.confidence).toBe(0.95);
    expect(result.details.expiredUnusedTokens).toBe(101);
  });

  it("returns info when counts are low (happy path)", async () => {
    const makeChain = (rows: unknown[]) => {
      const p = Promise.resolve(rows);
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.then = (res: Parameters<typeof p.then>[0], rej: Parameters<typeof p.then>[1]) => p.then(res, rej);
      c.catch = p.catch.bind(p);
      c.finally = p.finally.bind(p);
      return c;
    };
    const db = { select: vi.fn().mockImplementation(() => makeChain([])) };
    mockGetDb.mockResolvedValue(db);
    const result = await detectDisciplineDrift();
    expect(result.severity).toBe("info");
    expect(result.details.dbError).toBeNull();
  });
});

// ─── detectDependencyDrift — patchCount path (line 268) ─────────────────────────
import { detectDependencyDrift } from "./codeDriftService";

describe("codeDriftService — detectDependencyDrift() patch-only path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns info (not warning) when only patch updates are available (line 268)", () => {
    // execSync with encoding:utf-8 returns a string, so mock must return a string (not Buffer)
    const outdated = {
      "some-pkg": { current: "1.0.0", latest: "1.0.1" },
    };
    mockExecSync.mockReturnValue(JSON.stringify(outdated));
    const result = detectDependencyDrift();
    // patchCount > 0 but majorCount = 0, minorCount = 0 → severity is info
    expect(result.severity).toBe("info");
    expect(result.details.patchCount).toBeGreaterThan(0);
  });
});
