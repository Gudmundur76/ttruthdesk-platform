/**
 * index.ts — Public API for the Self-Prompting Engine (L2).
 *
 * Consumers should import from this file rather than individual modules.
 *
 * PRD-L2 §6.1 — Public API
 */

// ─── Core cycle entry point ───────────────────────────────────────────────────
export { runSelfPromptCycle } from "./engine";

// ─── State collection ─────────────────────────────────────────────────────────
export { collectSystemState } from "./stateCollector";

// ─── Prompt engine ────────────────────────────────────────────────────────────
export { runSelfPrompt, shouldConverge, priorityToLevel } from "./promptEngine";

// ─── Action executor ─────────────────────────────────────────────────────────
export {
  executeActions,
  executeAction,
  containsSqlInjection,
} from "./actionExecutor";

// ─── Directive publisher ──────────────────────────────────────────────────────
export {
  publishFrontierDirective,
  publishFrontierDirectives,
} from "./directivePublisher";

// ─── Convergence gate ─────────────────────────────────────────────────────────
export { applyConvergenceGate } from "./convergenceGate";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  SelfPromptEventType,
  SelfPromptEvent,
  GraphSnapshot,
  QueueSnapshot,
  MetaHealthSnapshot,
  ClaimTrends,
  GapAgeDistribution,
  FrontierStats,
  SelfPromptStats,
  ActiveDirective,
  DreamStats,
  MetaStats,
  DirectiveStats,
  SubscriptionSnapshot,
  SystemState,
  ActionPriority,
  PriorityLevel,
  SelfPromptAction,
  PrioritizedAction,
  SelfPrompt,
  FrontierDirectiveType,
  FrontierDirectiveInput,
  LlmResponse,
  ActionExecutionResult,
  SelfPromptCycleResult,
} from "./types";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────
export {
  LlmResponseSchema,
  PrioritizedActionSchema,
  FrontierDirectiveInputSchema,
} from "./schema";
