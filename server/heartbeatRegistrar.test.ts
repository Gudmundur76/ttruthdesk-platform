/**
 * heartbeatRegistrar.test.ts — Phase 106
 *
 * Unit tests for the heartbeat job registry.
 * No DB or network calls required — pure data validation.
 */

import { describe, it, expect } from "vitest";
import {
  REGISTERED_CRON_JOBS,
  getRegisteredJob,
  requireJobTaskUid,
} from "./heartbeatRegistrar";

// ─── REGISTERED_CRON_JOBS shape ───────────────────────────────────────────────

describe("REGISTERED_CRON_JOBS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(REGISTERED_CRON_JOBS)).toBe(true);
    expect(REGISTERED_CRON_JOBS.length).toBeGreaterThan(0);
  });

  it("every entry has a non-empty name", () => {
    for (const job of REGISTERED_CRON_JOBS) {
      expect(typeof job.name).toBe("string");
      expect(job.name.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty taskUid", () => {
    for (const job of REGISTERED_CRON_JOBS) {
      expect(typeof job.taskUid).toBe("string");
      expect(job.taskUid.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a valid 6-field cron expression", () => {
    // 6-field: sec min hour dom mon dow — each field is a non-empty string
    const sixFieldPattern = /^\S+ \S+ \S+ \S+ \S+ \S+$/;
    for (const job of REGISTERED_CRON_JOBS) {
      expect(job.cron).toMatch(sixFieldPattern);
    }
  });

  it("every path starts with /api/scheduled/", () => {
    for (const job of REGISTERED_CRON_JOBS) {
      expect(job.path.startsWith("/api/scheduled/")).toBe(true);
    }
  });

  it("every entry has a non-empty description", () => {
    for (const job of REGISTERED_CRON_JOBS) {
      expect(typeof job.description).toBe("string");
      expect(job.description.length).toBeGreaterThan(10);
    }
  });

  it("every entry has a registeredAt ISO timestamp", () => {
    for (const job of REGISTERED_CRON_JOBS) {
      const d = new Date(job.registeredAt);
      expect(isNaN(d.getTime())).toBe(false);
    }
  });

  it("all names are unique", () => {
    const names = REGISTERED_CRON_JOBS.map(j => j.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("all taskUids are unique", () => {
    const uids = REGISTERED_CRON_JOBS.map(j => j.taskUid);
    const unique = new Set(uids);
    expect(unique.size).toBe(uids.length);
  });

  it("includes the re-evaluate-composite-truth job registered in Phase 106", () => {
    const job = REGISTERED_CRON_JOBS.find(
      j => j.name === "re-evaluate-composite-truth"
    );
    expect(job).toBeDefined();
    expect(job!.taskUid).toBe("XYxgKr9QgnAZBhAvuCbnQR");
    expect(job!.path).toBe("/api/scheduled/re-evaluate");
    expect(job!.cron).toBe("0 0 */6 * * *");
  });

  it("includes the frontier-engine job (every 6 hours)", () => {
    const job = REGISTERED_CRON_JOBS.find(j => j.name === "frontier-engine");
    expect(job).toBeDefined();
    expect(job!.cron).toBe("0 0 */6 * * *");
  });

  it("includes the pmc-feed-nightly job (daily)", () => {
    const job = REGISTERED_CRON_JOBS.find(j => j.name === "pmc-feed-nightly");
    expect(job).toBeDefined();
    expect(job!.path).toBe("/api/scheduled/pmc-feed");
  });
});

// ─── getRegisteredJob ─────────────────────────────────────────────────────────

describe("getRegisteredJob", () => {
  it("returns the job when found by name", () => {
    const job = getRegisteredJob("re-evaluate-composite-truth");
    expect(job).toBeDefined();
    expect(job!.name).toBe("re-evaluate-composite-truth");
  });

  it("returns undefined for an unknown name", () => {
    const job = getRegisteredJob("non-existent-job-xyz");
    expect(job).toBeUndefined();
  });

  it("is case-sensitive", () => {
    const job = getRegisteredJob("RE-EVALUATE-COMPOSITE-TRUTH");
    expect(job).toBeUndefined();
  });
});

// ─── requireJobTaskUid ────────────────────────────────────────────────────────

describe("requireJobTaskUid", () => {
  it("returns the taskUid for a known job", () => {
    const uid = requireJobTaskUid("re-evaluate-composite-truth");
    expect(uid).toBe("XYxgKr9QgnAZBhAvuCbnQR");
  });

  it("returns the correct taskUid for pmc-feed-nightly", () => {
    const uid = requireJobTaskUid("pmc-feed-nightly");
    expect(uid).toBe("8KZcJgzfnDoLMUx2hGzUEv");
  });

  it("throws for an unknown job name", () => {
    expect(() => requireJobTaskUid("unknown-job")).toThrow(
      /Heartbeat job "unknown-job" is not registered/
    );
  });

  it("error message includes the job name and a hint", () => {
    try {
      requireJobTaskUid("my-missing-job");
    } catch (err) {
      expect((err as Error).message).toContain("my-missing-job");
      expect((err as Error).message).toContain("manus-heartbeat create");
    }
  });
});
