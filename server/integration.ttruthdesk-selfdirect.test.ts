/**
 * integration.ttruthdesk-selfdirect.test.ts
 *
 * Integration test: ttruthdesk → self-direct wiring.
 *
 * Scenario (mirrors the task specification):
 *   1. Inject a `verification.completed` event into ttruthdesk's
 *      verificationEventStore (simulating what verifyClaimRoute.ts does
 *      after fireVerdictWebhook()).
 *   2. Start a minimal Express server exposing /api/telemetry/summary.
 *   3. Instantiate self-direct's TelemetryPoller pointed at that server.
 *   4. Call readLatestRun() — verify it sees the injected event.
 *   5. Run a Watcher cycle — verify it emits a calibration_complete event
 *      when a low-performing adapter is detected.
 *   6. Confirm the emitted event contains the adapter seen in meta:status.
 *
 * This test is self-contained — no live DB, no live LLM, no external network.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { randomUUID } from "crypto";
import { verificationEventStore } from "./verificationEventStore";
import { registerTelemetrySummaryRoute } from "./telemetrySummaryRoute";

// ─── Lazy-import self-direct modules (they live in a sibling repo) ────────────
const SELF_DIRECT = "/home/ubuntu/self-direct/src";

async function loadTelemetryPoller() {
  const mod = await import(`${SELF_DIRECT}/watcher/telemetryPoller.js`);
  return mod.TelemetryPoller as any; // self-direct is a sibling repo; not present in this sandbox
}

async function loadWatcherDeps() {
  const [watcherMod, routerMod, machineMod, auditMod] = await Promise.all([
    import(`${SELF_DIRECT}/watcher/watcher.js`),
    import(`${SELF_DIRECT}/meta/eventRouter.js`),
    import(`${SELF_DIRECT}/meta/stateMachine.js`),
    import(`${SELF_DIRECT}/meta/auditLog.js`),
  ]);
  return {
    Watcher: watcherMod.Watcher,
    EventRouter: routerMod.EventRouter,
    StateMachine: machineMod.StateMachine,
    AuditLog: auditMod.AuditLog,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startTestServer(port: number): Promise<Server> {
  return new Promise(resolve => {
    const app = express();
    registerTelemetrySummaryRoute(app);
    const server = app.listen(port, () => resolve(server));
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ttruthdesk → self-direct integration wiring", () => {
  const TEST_PORT = 15099;
  let server: Server;

  beforeAll(async () => {
    verificationEventStore.clear();
    server = await startTestServer(TEST_PORT);
  });

  afterAll(async () => {
    await stopServer(server);
    verificationEventStore.clear();
  });

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  it("Step 1: ttruthdesk emits verification.completed events into the store", () => {
    // This mirrors what verifyClaimRoute.ts does after fireVerdictWebhook()
    verificationEventStore.push({
      inputId: randomUUID(),
      verdict: "Supported",
      adapter: "pubmed",
      confidence: 0.92,
      timestamp: new Date().toISOString(),
    });
    verificationEventStore.push({
      inputId: randomUUID(),
      verdict: "Contradicted",
      adapter: "pdb",
      confidence: 0.08,
      timestamp: new Date().toISOString(),
    });

    const all = verificationEventStore.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].verdict).toBe("Supported");
    expect(all[0].adapter).toBe("pubmed");
    expect(all[1].verdict).toBe("Contradicted");
    expect(all[1].adapter).toBe("pdb");
  });

  // ── Step 2 ─────────────────────────────────────────────────────────────────
  it("Step 2: /api/telemetry/summary reflects the injected events", async () => {
    const res = await fetch(
      `http://localhost:${TEST_PORT}/api/telemetry/summary`
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.summary.totalVerifications).toBe(2);
    expect(body.summary.supportedCount).toBe(1);
    expect(body.summary.contradictedCount).toBe(1);
    expect(body.summary.recentEvents).toHaveLength(2);
    expect(body.summary.recentEvents[0].adapter).toBe("pubmed");
    expect(body.summary.recentEvents[1].adapter).toBe("pdb");
  });

  // ── Step 3 ─────────────────────────────────────────────────────────────────
  it("Step 3: self-direct TelemetryPoller maps ttruthdesk events to CalibrationRunRecord", async () => {
    const TelemetryPoller = await loadTelemetryPoller();
    const poller = new TelemetryPoller({
      apiUrl: `http://localhost:${TEST_PORT}`,
    });
    const run = await poller.readLatestRun();
    expect(run).not.toBeNull();
    expect(run!.totalAdapters).toBe(2);

    const pubmed = run!.summaries.find((s: any) => s.adapterId === "pubmed");
    const pdb = run!.summaries.find((s: any) => s.adapterId === "pdb");
    expect(pubmed).toBeDefined();
    expect(pdb).toBeDefined();

    // pubmed: 1 supported / 1 total → supportedRate = 1.0 → G4 (passing)
    expect(pubmed!.failureGroup).toBe("G4");
    // pdb: 0 supported / 1 total → supportedRate = 0.0 → G1 (failing)
    expect(pdb!.failureGroup).toBe("G1");
  });

  // ── Step 4 ─────────────────────────────────────────────────────────────────
  it("Step 4: self-direct Watcher emits calibration_complete for low-performing adapter", async () => {
    const { Watcher, EventRouter, StateMachine, AuditLog } =
      await loadWatcherDeps();

    const emittedEvents: any[] = [];
    const machine = new StateMachine("WATCHING");
    const auditLog = new AuditLog("/tmp/self-direct-integration-audit.jsonl");
    const router = new EventRouter(machine, auditLog);
    router.on("calibration_complete", (event: any) => {
      emittedEvents.push(event);
    });

    const watcher = new Watcher(router, auditLog, {
      ttruthDeskApiUrl: `http://localhost:${TEST_PORT}`,
      snapshotDir: "/tmp/self-direct-test-snapshots",
    });

    const lowPerformers = await watcher.run();

    // pdb should be flagged (supportedRate=0, avgF1=0.08 — both below thresholds)
    expect(lowPerformers.length).toBeGreaterThan(0);
    expect(lowPerformers.some((a: any) => a.adapterId === "pdb")).toBe(true);

    // A calibration_complete event should have been emitted
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe("calibration_complete");
    expect(
      emittedEvents[0].lowPerformingAdapters.some(
        (a: any) => a.adapterId === "pdb"
      )
    ).toBe(true);
  });

  // ── Step 5 ─────────────────────────────────────────────────────────────────
  it("Step 5: meta:status — state machine transitions to DIAGNOSING on calibration_complete", async () => {
    const { Watcher, EventRouter, StateMachine, AuditLog } =
      await loadWatcherDeps();

    // Add a new event so the timestamp changes and the runId differs from Step 4
    // (Watcher deduplicates by runId — a new event in a new second produces a new runId)
    await new Promise(r => setTimeout(r, 1100)); // ensure new second
    verificationEventStore.push({
      inputId: randomUUID(),
      verdict: "Contradicted",
      adapter: "ncbi",
      confidence: 0.05,
      timestamp: new Date().toISOString(),
    });

    const machine = new StateMachine("WATCHING");
    const auditLog = new AuditLog("/tmp/self-direct-integration-audit2.jsonl");
    const router = new EventRouter(machine, auditLog);

    // Wire a handler that transitions the state machine (mirrors Orchestrator.wireHandlers)
    router.on("calibration_complete", async (_event: any) => {
      if (machine.state === "WATCHING") {
        machine.transition("DIAGNOSING", "calibration_complete");
      }
    });

    const watcher = new Watcher(router, auditLog, {
      ttruthDeskApiUrl: `http://localhost:${TEST_PORT}`,
      snapshotDir: "/tmp/self-direct-test-snapshots",
    });

    // Before run: state is WATCHING
    expect(machine.state).toBe("WATCHING");

    await watcher.run();

    // Give the event loop a tick to process the async handler
    await new Promise(r => setTimeout(r, 50));

    // After run: state should have transitioned to DIAGNOSING
    // (because pdb/ncbi are low-performers → calibration_complete was emitted)
    expect(machine.state).toBe("DIAGNOSING");

    // Context reflects the transition
    // Note: cycleCount only increments when returning to WATCHING — not on WATCHING→DIAGNOSING
    expect(machine.context.history.length).toBeGreaterThan(0);
    expect(machine.context.history[0].trigger).toBe("calibration_complete");
    expect(machine.context.history[0].from).toBe("WATCHING");
    expect(machine.context.history[0].to).toBe("DIAGNOSING");
  });
});
