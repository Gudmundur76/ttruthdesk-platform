/**
 * schema.ts — Zod validation schemas for the Self-Prompting Engine (L2).
 *
 * Validates raw LLM JSON output before it is trusted by the engine.
 *
 * PRD-L2 §6.1 — LlmResponseSchema
 */
import { z } from "zod";

// ─── Action Schema ────────────────────────────────────────────────────────────

export const PrioritizedActionSchema = z.object({
  priority: z.number().min(1).max(100),
  action: z.string().min(1),
  targetId: z.number().int(),
  reasoning: z.string(),
  justification: z.string().default(""),
  expectedValue: z.number().min(0).max(100),
});

export type PrioritizedActionInput = z.infer<typeof PrioritizedActionSchema>;

// ─── Directive Schema ─────────────────────────────────────────────────────────

export const FrontierDirectiveInputSchema = z.object({
  directiveType: z.enum([
    "focus_gap",
    "skip_mapping",
    "prioritize_hypotheses",
    "deep_dive_entity",
  ]),
  targetId: z.number().int().optional(),
  reason: z.string().min(20),
  confidence: z.number().min(0).max(1).optional(),
  ttlMinutes: z.number().int().min(1).max(1440).optional(),
});

export type FrontierDirectiveInputParsed = z.infer<
  typeof FrontierDirectiveInputSchema
>;

// ─── LLM Response Schema ──────────────────────────────────────────────────────

/**
 * LlmResponseSchema — validates the full JSON object returned by the LLM.
 *
 * PRD-L2 §6.1 requirements:
 *   - reasoning: min 100 chars (ensures non-trivial chain-of-thought)
 *   - actions: array of PrioritizedActionSchema (capped at 5 in promptEngine)
 *   - directives: optional array (capped at 3 in promptEngine)
 *   - converge: boolean
 *   - convergenceReason: nullable string
 */
export const LlmResponseSchema = z.object({
  reasoning: z.string().min(100, "Reasoning must be at least 100 characters"),
  actions: z.array(PrioritizedActionSchema),
  directives: z.array(FrontierDirectiveInputSchema).optional().default([]),
  converge: z.boolean(),
  convergenceReason: z.string().nullable().optional(),
});

export type LlmResponseInput = z.infer<typeof LlmResponseSchema>;
