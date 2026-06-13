/**
 * server/logger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured logger for the ttruthdesk-platform backend.
 *
 * Design principles (CodeRabbit rule 8: no console.* in production code):
 *   - All log output is structured JSON in production (NODE_ENV=production)
 *   - Human-readable prefixed output in development
 *   - Log levels: debug < info < warn < error
 *   - Every log entry includes: level, timestamp (ISO 8601), component, message
 *   - Optional `data` field for structured context (never serialises secrets)
 *   - Zero dependencies — uses process.stdout/stderr directly
 *
 * Usage:
 *   import { logger } from "./logger";
 *   const log = logger("analysisPipeline");
 *
 *   log.info("Pipeline started", { claimId: "abc123" });
 *   log.warn("Evidence lookup failed (non-fatal)", { sourceId: "pubmed", err: e.message });
 *   log.error("Fatal pipeline error", { err: e.message, stack: e.stack });
 *
 * The `logger(component)` factory returns a ComponentLogger scoped to a named
 * subsystem. This makes log filtering trivial in production:
 *   grep '"component":"analysisPipeline"' app.log
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface ComponentLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// ─── Level ordering ───────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

// ─── Environment config ───────────────────────────────────────────────────────

const IS_PRODUCTION = process.env["NODE_ENV"] === "production";
const MIN_LEVEL: LogLevel = (process.env["LOG_LEVEL"] as LogLevel | undefined) ?? (IS_PRODUCTION ? "info" : "debug");

// ANSI colour codes for development output
const COLOURS: Record<LogLevel, string> = {
  debug: "\x1b[36m",  // cyan
  info:  "\x1b[32m",  // green
  warn:  "\x1b[33m",  // yellow
  error: "\x1b[31m",  // red
};
const RESET = "\x1b[0m";

// ─── Core emit function ───────────────────────────────────────────────────────

function emit(entry: LogEntry): void {
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[MIN_LEVEL]) return;

  if (IS_PRODUCTION) {
    // Structured JSON — one line per entry, parseable by log aggregators
    const line = JSON.stringify(entry);
    if (entry.level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  } else {
    // Human-readable for development
    const colour = COLOURS[entry.level];
    const prefix = `${colour}[${entry.level.toUpperCase().padEnd(5)}]${RESET}`;
    const ts = entry.timestamp.substring(11, 23); // HH:MM:SS.mmm
    const component = `\x1b[90m[${entry.component}]${RESET}`;
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
    const line = `${prefix} ${ts} ${component} ${entry.message}${dataStr}`;
    if (entry.level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function logger(component: string): ComponentLogger {
  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    emit({
      level,
      timestamp: new Date().toISOString(),
      component,
      message,
      ...(data !== undefined ? { data } : {}),
    });
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info:  (msg, data) => log("info",  msg, data),
    warn:  (msg, data) => log("warn",  msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}

// ─── Convenience: extract safe error fields ───────────────────────────────────
// Use this when logging caught errors to avoid serialising circular references.

export function errData(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      err: error.message,
      ...(error.stack ? { stack: error.stack.split("\n").slice(0, 5).join(" | ") } : {}),
    };
  }
  return { err: String(error) };
}
