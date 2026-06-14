import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./db", () => ({
  getDocumentById: vi.fn(),
}));
vi.mock("./analysisPipeline", () => ({
  runAnalysisPipeline: vi.fn(),
}));

import { getDocumentById } from "./db";
import { runAnalysisPipeline } from "./analysisPipeline";
import { registerBatchVerifyRoute } from "./batchVerifyRoute";

function buildApp() {
  const app = express();
  app.use(express.json());
  registerBatchVerifyRoute(app);
  return app;
}

describe("POST /api/v2/verify/batch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when documentIds is missing", async () => {
    const res = await request(buildApp()).post("/api/v2/verify/batch").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when documentIds is not an array", async () => {
    const res = await request(buildApp())
      .post("/api/v2/verify/batch")
      .send({ documentIds: "42" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when documentIds is empty", async () => {
    const res = await request(buildApp())
      .post("/api/v2/verify/batch")
      .send({ documentIds: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when documentIds exceeds 20", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1);
    const res = await request(buildApp())
      .post("/api/v2/verify/batch")
      .send({ documentIds: ids });
    expect(res.status).toBe(400);
  });

  it("returns per-document results for valid batch", async () => {
    (getDocumentById as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 1, rawText: "text one", userId: 10 })
      .mockResolvedValueOnce({ id: 2, rawText: "text two", userId: 10 });
    (runAnalysisPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined
    );

    const res = await request(buildApp())
      .post("/api/v2/verify/batch")
      .send({ documentIds: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(2);
    expect(runAnalysisPipeline).toHaveBeenCalledTimes(2);
  });

  it("marks a document as not_found when getDocumentById returns null", async () => {
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v2/verify/batch")
      .send({ documentIds: [999] });
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].status).toBe("not_found");
  });

  it("marks a document as failed when pipeline throws", async () => {
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1,
      rawText: "text",
      userId: 10,
    });
    (runAnalysisPipeline as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("pipeline exploded")
    );
    const res = await request(buildApp())
      .post("/api/v2/verify/batch")
      .send({ documentIds: [1] });
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].status).toBe("failed");
    expect(res.body.data.results[0].error).toMatch(/pipeline exploded/);
  });

  it("result entries have documentId and status fields", async () => {
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1,
      rawText: "text",
      userId: 10,
    });
    (runAnalysisPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined
    );
    const res = await request(buildApp())
      .post("/api/v2/verify/batch")
      .send({ documentIds: [1] });
    const entry = res.body.data.results[0];
    expect(entry).toHaveProperty("documentId");
    expect(entry).toHaveProperty("status");
  });
});
