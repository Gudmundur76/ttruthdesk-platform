/**
 * batchVerifyRoute.test.ts
 * Tests for POST /api/v2/verify/batch
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDocumentById: vi.fn(),
  mockRunAnalysisPipeline: vi.fn(),
}));

vi.mock("./db", () => ({
  getDocumentById: mocks.mockGetDocumentById,
}));
vi.mock("./analysisPipeline", () => ({
  runAnalysisPipeline: mocks.mockRunAnalysisPipeline,
}));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

import express from "express";
import request from "supertest";
import { registerBatchVerifyRoute } from "./batchVerifyRoute";

function makeApp() {
  const app = express();
  app.use(express.json());
  registerBatchVerifyRoute(app as express.Express);
  return app;
}

describe("POST /api/v2/verify/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when documentIds is missing", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/v2/verify/batch").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/non-empty array/i);
  });

  it("returns 400 when documentIds is an empty array", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 when documentIds exceeds 20 items", async () => {
    const app = makeApp();
    const ids = Array.from({ length: 21 }, (_, i) => i + 1);
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: ids });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/20/);
  });

  it("returns 400 when documentIds is not an array", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns queued status for found documents", async () => {
    mocks.mockGetDocumentById.mockResolvedValue({
      id: 1,
      rawText: "test text",
      userId: 42,
    });
    mocks.mockRunAnalysisPipeline.mockResolvedValue(undefined);
    const app = makeApp();
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: [1] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.results[0]).toEqual({
      documentId: 1,
      status: "queued",
    });
  });

  it("returns not_found status for missing documents", async () => {
    mocks.mockGetDocumentById.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: [99] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.results[0]).toEqual({
      documentId: 99,
      status: "not_found",
    });
  });

  it("returns failed status when pipeline throws", async () => {
    mocks.mockGetDocumentById.mockResolvedValue({
      id: 5,
      rawText: "text",
      userId: 1,
    });
    mocks.mockRunAnalysisPipeline.mockRejectedValue(new Error("pipeline error"));
    const app = makeApp();
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: [5] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.results[0].status).toBe("failed");
    expect(res.body.data.results[0].error).toMatch(/pipeline error/);
  });

  it("processes multiple documents and mixes statuses", async () => {
    mocks.mockGetDocumentById
      .mockResolvedValueOnce({ id: 1, rawText: "text1", userId: 1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 3, rawText: "text3", userId: 1 });
    mocks.mockRunAnalysisPipeline
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("fail"));
    const app = makeApp();
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: [1, 2, 3] });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    const statuses = res.body.data.results.map((r: { status: string }) => r.status);
    expect(statuses).toContain("queued");
    expect(statuses).toContain("not_found");
    expect(statuses).toContain("failed");
  });

  it("handles exactly 20 documents (at the limit)", async () => {
    mocks.mockGetDocumentById.mockResolvedValue(null);
    const ids = Array.from({ length: 20 }, (_, i) => i + 1);
    const app = makeApp();
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: ids });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(20);
  });

  it("calls runAnalysisPipeline with correct arguments", async () => {
    mocks.mockGetDocumentById.mockResolvedValue({
      id: 7,
      rawText: "some text",
      userId: 99,
    });
    mocks.mockRunAnalysisPipeline.mockResolvedValue(undefined);
    const app = makeApp();
    await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: [7] });
    expect(mocks.mockRunAnalysisPipeline).toHaveBeenCalledWith(7, "some text", 99);
  });

  it("handles null rawText and userId gracefully", async () => {
    mocks.mockGetDocumentById.mockResolvedValue({
      id: 8,
      rawText: null,
      userId: null,
    });
    mocks.mockRunAnalysisPipeline.mockResolvedValue(undefined);
    const app = makeApp();
    const res = await request(app)
      .post("/api/v2/verify/batch")
      .send({ documentIds: [8] });
    expect(res.status).toBe(200);
    expect(mocks.mockRunAnalysisPipeline).toHaveBeenCalledWith(8, "", 0);
  });
});
