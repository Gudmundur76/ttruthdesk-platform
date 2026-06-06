/**
 * coordApi/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * REST API for the Manus Coordination Layer.
 *
 * Replaces the monolithic coordApi.ts (730 lines) with four focused sub-routers:
 *   queueRouter    — work queue (enqueue / dequeue / complete / fail / stats)
 *   tasksRouter    — task registry (register / heartbeat / complete / fail)
 *   contextRouter  — key-value context store
 *   memoryRouter   — knowledge-graph memory (nodes / edges)
 *
 * Authentication: all /api/coord/* endpoints require the X-Coord-Key header
 * to match COORD_API_KEY env var. If the key is not configured, endpoints
 * return 503.
 *
 * Drop-in replacement: mount with
 *   app.use("/api/coord", createCoordRouter());
 */
import { Router as makeRouter } from "express";
import { coordAuth } from "./shared";
import { createQueueRouter } from "./queueRouter";
import { createTasksRouter } from "./tasksRouter";
import { createContextRouter } from "./contextRouter";
import { createMemoryRouter } from "./memoryRouter";

export function createCoordRouter() {
  const router = makeRouter();

  // Apply auth to all /api/coord/* endpoints
  router.use(coordAuth);

  // Mount sub-routers
  router.use("/queue", createQueueRouter());
  router.use("/tasks", createTasksRouter());
  router.use("/context", createContextRouter());
  router.use("/memory", createMemoryRouter());

  return router;
}
