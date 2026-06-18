/**
 * stageRegistry.ts — Typed StageRegistry scaffold with 15-stage pipeline.
 *
 * PRD-L1 Phase 1: Each stage is a typed function (claim, context) → StageResult.
 * Stages are registered by name and executed in order. Fatal stages abort the
 * pipeline on SKIP or FAIL.
 */

export type StageOutcome = "PASS" | "SKIP" | "FAIL";

export interface StageResult {
  outcome: StageOutcome;
  reason?: string;
  data?: Record<string, unknown>;
}

export interface StageContext {
  documentId: number;
  documentStatus: string;
  qualityTier: string;
  claimId?: number;
  claimText?: string;
  claimType?: string;
  correlationId?: string;
  // Stage output accumulation
  extractedClaims?: unknown[];
  passages?: unknown[];
  misrepresentationType?: string;
  adapterResult?: unknown;
  compositeScore?: number;
  compositeLabel?: string;
  reportUrl?: string;
  confidenceTrend?: unknown;
  predictionId?: number;
  auditTrail?: Record<string, unknown>[];
}

export type StageFn = (context: StageContext) => Promise<StageResult>;

export interface StageDefinition {
  id: number;
  name: string;
  fn: StageFn;
  /** If true, a SKIP or FAIL from this stage aborts the entire pipeline. */
  fatal?: boolean;
}

export interface PipelineResult {
  success: boolean;
  stagesRun: number;
  abortedAt?: string;
  abortReason?: string;
  results: { stage: string; outcome: StageOutcome; reason?: string; data?: Record<string, unknown> }[];
}

export class StageRegistry {
  private stages: StageDefinition[] = [];

  register(stage: StageDefinition): void {
    if (this.stages.find(s => s.id === stage.id)) {
      throw new Error(`Stage with id ${stage.id} already registered`);
    }
    this.stages.push(stage);
    this.stages.sort((a, b) => a.id - b.id);
  }

  getStage(id: number): StageDefinition | undefined {
    return this.stages.find(s => s.id === id);
  }

  getStageByName(name: string): StageDefinition | undefined {
    return this.stages.find(s => s.name === name);
  }

  listStages(): StageDefinition[] {
    return [...this.stages];
  }

  async execute(context: StageContext): Promise<PipelineResult> {
    const results: PipelineResult["results"] = [];
    let stagesRun = 0;

    for (const stage of this.stages) {
      let result: StageResult;
      try {
        result = await stage.fn(context);
      } catch (err) {
        result = { outcome: "FAIL", reason: String(err) };
      }

      results.push({ stage: stage.name, outcome: result.outcome, reason: result.reason, data: result.data });
      stagesRun++;

      // Merge data into context for downstream stages
      if (result.data) {
        Object.assign(context, result.data);
      }

      // Fatal stages abort on SKIP or FAIL
      if (stage.fatal && (result.outcome === "SKIP" || result.outcome === "FAIL")) {
        return {
          success: false,
          stagesRun,
          abortedAt: stage.name,
          abortReason: result.reason ?? `Stage ${stage.name} returned ${result.outcome}`,
          results,
        };
      }

      // Non-fatal FAIL also aborts
      if (result.outcome === "FAIL") {
        return {
          success: false,
          stagesRun,
          abortedAt: stage.name,
          abortReason: result.reason ?? `Stage ${stage.name} failed`,
          results,
        };
      }
    }

    return { success: true, stagesRun, results };
  }
}

// ─── Global Stage Registry ────────────────────────────────────────────────────

import {
  draftGuardStage,
  claimExtractionStage,
  passageExtractionStage,
  misrepresentationClassifierStage,
  adapterRouterStage,
  verdictAggregatorStage,
} from "./stages";

import {
  compositeTruthEngineStage,
  reportGeneratorStage,
  confidenceTrendStage,
  predictionRecordStage,
  pipelineAuditorStage,
} from "./stagesPhase56";

export const globalStageRegistry = new StageRegistry();

// Stage 0: DraftGuard (fatal — skip pending/draft documents)
globalStageRegistry.register({ id: 0, name: "DraftGuard", fn: draftGuardStage, fatal: true });

// Stage 1: ClaimExtraction
globalStageRegistry.register({ id: 1, name: "ClaimExtraction", fn: claimExtractionStage });

// Stage 2: PassageExtraction
globalStageRegistry.register({ id: 2, name: "PassageExtraction", fn: passageExtractionStage });

// Stage 3: MisrepresentationClassifier
globalStageRegistry.register({ id: 3, name: "MisrepresentationClassifier", fn: misrepresentationClassifierStage });

// Stage 4: AdapterRouter
globalStageRegistry.register({ id: 4, name: "AdapterRouter", fn: adapterRouterStage });

// Stage 5: VerdictAggregator
globalStageRegistry.register({ id: 5, name: "VerdictAggregator", fn: verdictAggregatorStage });

// Stage 6: CompositeTruthEngine
globalStageRegistry.register({ id: 6, name: "CompositeTruthEngine", fn: compositeTruthEngineStage });

// Stage 7: ReportGenerator
globalStageRegistry.register({ id: 7, name: "ReportGenerator", fn: reportGeneratorStage });

// Stage 8: ConfidenceTrend
globalStageRegistry.register({ id: 8, name: "ConfidenceTrend", fn: confidenceTrendStage });

// Stage 9: PredictionRecord
globalStageRegistry.register({ id: 9, name: "PredictionRecord", fn: predictionRecordStage });

// Stage 10: PipelineAuditor
globalStageRegistry.register({ id: 10, name: "PipelineAuditor", fn: pipelineAuditorStage });
