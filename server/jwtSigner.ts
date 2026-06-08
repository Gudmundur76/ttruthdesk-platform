/**
 * jwtSigner.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * RS256 JWT sign and verify helpers backed by the RSA-2048 key pair in
 * server/jwksKeys.ts. The corresponding public key is advertised at
 * /.well-known/jwks.json so any external party can verify tokens without
 * sharing a symmetric secret.
 *
 * Usage:
 *   import { signJwt, verifyJwt } from "./jwtSigner";
 *
 *   // Issue a token
 *   const token = await signJwt({ sub: "user_123", scope: "read" }, { expiresIn: "1h" });
 *
 *   // Verify a token (throws on invalid/expired)
 *   const payload = await verifyJwt(token);
 *
 * The session cookie is still signed with HS256 (JWT_SECRET) by sdk.ts —
 * that is a first-party symmetric secret and does not need to be publicly
 * verifiable. Use RS256 (this module) for tokens you hand to third parties:
 *   - API keys issued as JWTs (Bearer tokens for external integrations)
 *   - Webhook signatures
 *   - Any token a third party needs to verify without calling your server
 */

import { SignJWT, jwtVerify, importPKCS8, importSPKI, type JWTPayload } from "jose";
import crypto from "crypto";
import { ACTIVE_PRIVATE_KEY_PEM, ACTIVE_JWK_PUBLIC_KEY } from "./jwksKeys";

// ─── Key import (done once at module load) ────────────────────────────────────

let _privateKey: Awaited<ReturnType<typeof importPKCS8>> | null = null;
let _publicKey: Awaited<ReturnType<typeof importSPKI>> | null = null;

async function getPrivateKey() {
  if (!_privateKey) {
    _privateKey = await importPKCS8(ACTIVE_PRIVATE_KEY_PEM, "RS256");
  }
  return _privateKey;
}

async function getPublicKey() {
  if (!_publicKey) {
    // Derive the public key from the private key PEM
    const privKeyObj = crypto.createPrivateKey({ key: ACTIVE_PRIVATE_KEY_PEM, format: "pem" });
    const pubKeyObj = crypto.createPublicKey(privKeyObj);
    const pubPem = pubKeyObj.export({ type: "spki", format: "pem" }) as string;
    _publicKey = await importSPKI(pubPem, "RS256");
  }
  return _publicKey;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignOptions {
  /** Expiry as a jose duration string, e.g. "1h", "7d", "30d". Default: "1h". */
  expiresIn?: string;
  /** Issuer claim. Default: "truthdesk.claims". */
  issuer?: string;
  /** Audience claim. */
  audience?: string | string[];
}

export interface VerifyOptions {
  /** Expected issuer. Default: "truthdesk.claims". */
  issuer?: string;
  /** Expected audience. */
  audience?: string | string[];
}

const DEFAULT_ISSUER = "truthdesk.claims";

// ─── sign ─────────────────────────────────────────────────────────────────────

/**
 * Sign a payload with RS256 using the project's RSA-2048 private key.
 * The `kid` header is set to the active key ID so verifiers can look up
 * the public key from /.well-known/jwks.json.
 */
export async function signJwt(
  payload: JWTPayload & Record<string, unknown>,
  options: SignOptions = {}
): Promise<string> {
  const { expiresIn = "1h", issuer = DEFAULT_ISSUER, audience } = options;
  const privKey = await getPrivateKey();
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: ACTIVE_JWK_PUBLIC_KEY.kid })
    .setIssuedAt()
    .setIssuer(issuer)
    .setExpirationTime(expiresIn);
  if (audience) builder.setAudience(audience);
  return builder.sign(privKey);
}

// ─── verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a RS256 JWT issued by this server.
 * Returns the decoded payload on success, throws on failure.
 */
export async function verifyJwt(
  token: string,
  options: VerifyOptions = {}
): Promise<JWTPayload & Record<string, unknown>> {
  const { issuer = DEFAULT_ISSUER, audience } = options;
  const pubKey = await getPublicKey();
  const verifyOpts: Parameters<typeof jwtVerify>[2] = {
    algorithms: ["RS256"],
    issuer,
  };
  if (audience) verifyOpts.audience = audience;
  const { payload } = await jwtVerify(token, pubKey, verifyOpts);
  return payload as JWTPayload & Record<string, unknown>;
}

// ─── Convenience: issue a short-lived API bearer token ───────────────────────

export interface ApiTokenPayload {
  sub: string;        // user ID (string)
  scope: string;      // space-separated scopes, e.g. "read write"
  kid?: string;       // key ID (set automatically)
  label?: string;     // human-readable key label
}

/**
 * Issue a signed API bearer token for external integrations.
 * Tokens are RS256-signed and verifiable via /.well-known/jwks.json.
 */
export async function issueApiToken(
  payload: ApiTokenPayload,
  options: Pick<SignOptions, "expiresIn" | "audience"> = {}
): Promise<string> {
  return signJwt(
    {
      sub: payload.sub,
      scope: payload.scope,
      label: payload.label ?? "",
    },
    {
      expiresIn: options.expiresIn ?? "365d",
      audience: options.audience ?? "truthdesk.claims/api",
    }
  );
}

/**
 * Verify an API bearer token and return the payload.
 * Throws if the token is invalid, expired, or has the wrong audience.
 */
export async function verifyApiToken(token: string): Promise<ApiTokenPayload> {
  const payload = await verifyJwt(token, { audience: "truthdesk.claims/api" });
  return {
    sub: (payload.sub as string) ?? "",
    scope: (payload.scope as string) ?? "",
    label: (payload.label as string) ?? "",
  };
}
