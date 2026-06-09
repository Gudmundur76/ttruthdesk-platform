/**
 * db.coverage.test.ts
 *
 * Unit tests for db.ts query helpers — null-guard branches.
 *
 * Strategy: mock `drizzle-orm/mysql2` so that `drizzle()` returns null,
 * which forces getDb() to return null, exercising the early-return guards
 * in every helper function.
 *
 * This approach tests the null-safety of every exported helper without
 * needing a real database connection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle so getDb() resolves to null (no DB available)
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn().mockReturnValue(null),
}));

// Also ensure DATABASE_URL is set so the init path is triggered,
// but drizzle() returns null so _db stays null.
vi.stubEnv("DATABASE_URL", "mysql://mock:mock@localhost/mock");

describe("db helpers — null-guard branches (DB unavailable)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getDocumentById returns null when DB is null", async () => {
    const { getDocumentById } = await import("./db");
    const result = await getDocumentById(1);
    expect(result).toBeNull();
  });

  it("getDocumentsByUser returns [] when DB is null", async () => {
    const { getDocumentsByUser } = await import("./db");
    const result = await getDocumentsByUser(1);
    expect(result).toEqual([]);
  });

  it("getClaimsByDocument returns [] when DB is null", async () => {
    const { getClaimsByDocument } = await import("./db");
    const result = await getClaimsByDocument(1);
    expect(result).toEqual([]);
  });

  it("getAllAuditRequests returns [] when DB is null", async () => {
    const { getAllAuditRequests } = await import("./db");
    const result = await getAllAuditRequests();
    expect(result).toEqual([]);
  });

  it("getAuditReportByDocument returns null when DB is null", async () => {
    const { getAuditReportByDocument } = await import("./db");
    const result = await getAuditReportByDocument(1);
    expect(result).toBeNull();
  });

  it("getEmailUserByEmail returns undefined when DB is null", async () => {
    const { getEmailUserByEmail } = await import("./db");
    const result = await getEmailUserByEmail("test@example.com");
    expect(result).toBeUndefined();
  });

  it("getEmailUserById returns undefined when DB is null", async () => {
    const { getEmailUserById } = await import("./db");
    const result = await getEmailUserById(1);
    expect(result).toBeUndefined();
  });

  it("getUserByOpenId returns undefined when DB is null", async () => {
    const { getUserByOpenId } = await import("./db");
    const result = await getUserByOpenId("open_id_123");
    expect(result).toBeUndefined();
  });

  it("getFailedDocuments returns [] when DB is null", async () => {
    const { getFailedDocuments } = await import("./db");
    const result = await getFailedDocuments();
    expect(result).toEqual([]);
  });

  it("getDraftDocuments returns [] when DB is null", async () => {
    const { getDraftDocuments } = await import("./db");
    const result = await getDraftDocuments();
    expect(result).toEqual([]);
  });

  it("getAllMonitoringFeed returns [] when DB is null", async () => {
    const { getAllMonitoringFeed } = await import("./db");
    const result = await getAllMonitoringFeed();
    expect(result).toEqual([]);
  });

  it("getGraphData returns {documents:[], claims:[]} when DB is null", async () => {
    const { getGraphData } = await import("./db");
    const result = await getGraphData();
    expect(result).toHaveProperty("documents");
    expect(result).toHaveProperty("claims");
    expect(result.documents).toEqual([]);
    expect(result.claims).toEqual([]);
  });

  it("getVerticalStats returns [] when DB is null", async () => {
    const { getVerticalStats } = await import("./db");
    const result = await getVerticalStats();
    expect(result).toEqual([]);
  });

  it("getAllGraphEntities returns [] when DB is null", async () => {
    const { getAllGraphEntities } = await import("./db");
    const result = await getAllGraphEntities();
    expect(result).toEqual([]);
  });

  it("getAllGraphRelations returns [] when DB is null", async () => {
    const { getAllGraphRelations } = await import("./db");
    const result = await getAllGraphRelations();
    expect(result).toEqual([]);
  });

  it("getContradictionRelations returns [] when DB is null", async () => {
    const { getContradictionRelations } = await import("./db");
    const result = await getContradictionRelations();
    expect(result).toEqual([]);
  });

  it("getRecentAuditRequestsByEmail returns 0 when DB is null", async () => {
    const { getRecentAuditRequestsByEmail } = await import("./db");
    const result = await getRecentAuditRequestsByEmail(
      "test@example.com",
      60_000
    );
    expect(result).toBe(0);
  });

  it("getMonitoringFeedByDocument returns [] when DB is null", async () => {
    const { getMonitoringFeedByDocument } = await import("./db");
    const result = await getMonitoringFeedByDocument(1);
    expect(result).toEqual([]);
  });

  it("deleteClaimsByDocument does not throw when DB is null", async () => {
    const { deleteClaimsByDocument } = await import("./db");
    await expect(deleteClaimsByDocument(1)).resolves.not.toThrow();
  });

  it("markMagicLinkTokenUsed does not throw when DB is null", async () => {
    const { markMagicLinkTokenUsed } = await import("./db");
    await expect(markMagicLinkTokenUsed(1)).resolves.not.toThrow();
  });

  it("markAuditRequestOwnerNotified does not throw when DB is null", async () => {
    const { markAuditRequestOwnerNotified } = await import("./db");
    await expect(markAuditRequestOwnerNotified(1)).resolves.not.toThrow();
  });

  it("getOverrideAuditLog returns [] when DB is null", async () => {
    const { getOverrideAuditLog } = await import("./db");
    const result = await getOverrideAuditLog(1);
    expect(result).toEqual([]);
  });

  it("getGraphEntitiesByType returns [] when DB is null", async () => {
    const { getGraphEntitiesByType } = await import("./db");
    const result = await getGraphEntitiesByType("protein", 10);
    expect(result).toEqual([]);
  });
});
