/**
 * hmacSigner.ts — HMAC-SHA256 event signing.
 *
 * PRD-MASTER NFR-MASTER-06: All events published to the event bus MUST be
 * signed with HMAC-SHA256 using the JWT_SECRET. Unsigned events MUST be
 * rejected by the orchestrator.
 */

import { createHmac, timingSafeEqual } from "crypto";

/** The HMAC algorithm used for event signing. */
const ALGORITHM = "sha256";

/**
 * Compute the HMAC-SHA256 signature for an event payload.
 *
 * @param payload - The serialised event payload (JSON string).
 * @param secret  - The signing secret (defaults to JWT_SECRET env var).
 * @returns Hex-encoded HMAC signature.
 */
export function signEvent(payload: string, secret?: string): string {
  const key = secret ?? process.env.JWT_SECRET ?? "dev-secret";
  return createHmac(ALGORITHM, key).update(payload).digest("hex");
}

/**
 * Verify that a signature matches the expected HMAC for the payload.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param payload   - The serialised event payload (JSON string).
 * @param signature - The hex-encoded signature to verify.
 * @param secret    - The signing secret (defaults to JWT_SECRET env var).
 * @returns true if the signature is valid.
 */
export function verifyEventSignature(
  payload: string,
  signature: string,
  secret?: string
): boolean {
  try {
    const expected = signEvent(payload, secret);
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Build a signed event envelope.
 * The signature covers the JSON-serialised payload + eventType + timestamp.
 */
export function buildSignedEnvelope<T>(
  eventType: string,
  payload: T,
  correlationId: string
): {
  eventType: string;
  payload: T;
  correlationId: string;
  timestamp: number;
  signature: string;
} {
  const timestamp = Date.now();
  const sigInput = JSON.stringify({ eventType, payload, correlationId, timestamp });
  const signature = signEvent(sigInput);
  return { eventType, payload, correlationId, timestamp, signature };
}

/**
 * Verify a signed event envelope.
 */
export function verifySignedEnvelope(envelope: {
  eventType: string;
  payload: unknown;
  correlationId: string;
  timestamp: number;
  signature: string;
}): boolean {
  const { signature, ...rest } = envelope;
  const sigInput = JSON.stringify(rest);
  return verifyEventSignature(sigInput, signature);
}
