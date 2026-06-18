/**
 * layerError.ts — Typed LayerError class with propagation support.
 *
 * PRD-MASTER: All layer failures MUST be wrapped in a LayerError so the
 * orchestrator can distinguish recoverable from fatal errors and propagate
 * context (correlationId, layerId) through the error chain.
 */

export type LayerErrorSeverity = "warning" | "error" | "fatal";

export interface LayerErrorContext {
  correlationId?: string;
  layerId?: string;
  eventType?: string;
  documentId?: number;
  claimId?: number;
  [key: string]: unknown;
}

/**
 * LayerError wraps any error thrown inside an autonomous loop layer.
 * It carries structured context for observability and recovery decisions.
 */
export class LayerError extends Error {
  public readonly severity: LayerErrorSeverity;
  public readonly context: LayerErrorContext;
  public readonly cause: Error | undefined;
  public readonly timestamp: number;

  constructor(
    message: string,
    options: {
      severity?: LayerErrorSeverity;
      context?: LayerErrorContext;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "LayerError";
    this.severity = options.severity ?? "error";
    this.context = options.context ?? {};
    this.cause = options.cause instanceof Error ? options.cause : undefined;
    this.timestamp = Date.now();

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, LayerError.prototype);
  }

  /**
   * Returns true if this error should abort the entire loop run.
   */
  isFatal(): boolean {
    return this.severity === "fatal";
  }

  /**
   * Returns true if this error should be logged but not abort the run.
   */
  isRecoverable(): boolean {
    return this.severity === "warning" || this.severity === "error";
  }

  /**
   * Serialise to a plain object for logging / telemetry.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      severity: this.severity,
      context: this.context,
      cause: this.cause?.message,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  /**
   * Wrap an unknown thrown value as a LayerError.
   * If it is already a LayerError, return it unchanged.
   */
  static wrap(
    err: unknown,
    context?: LayerErrorContext,
    severity?: LayerErrorSeverity
  ): LayerError {
    if (err instanceof LayerError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new LayerError(message, {
      severity: severity ?? "error",
      context,
      cause: err instanceof Error ? err : undefined,
    });
  }
}
