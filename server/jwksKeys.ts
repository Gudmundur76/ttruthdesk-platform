/**
 * JWKS key material for /.well-known/jwks.json
 *
 * The private key is stored here as the project-level default. For production
 * rotation, set JWKS_PRIVATE_KEY in the environment secrets — the server will
 * prefer the env value over this built-in key.
 *
 * To rotate:
 *   1. Generate a new RSA-2048 key pair (node -e "require('crypto').generateKeyPairSync(...)")
 *   2. Update JWKS_PRIVATE_KEY in Settings → Secrets
 *   3. Redeploy — the new public key will appear in /.well-known/jwks.json automatically
 */

import crypto from "crypto";
import { logger } from "./logger";
const log = logger("jwksKeys");


// Built-in RSA-2048 key pair (generated at project init, 2026-06-06).
// Override via JWKS_PRIVATE_KEY environment secret.
const BUILT_IN_PRIVATE_KEY_PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDV2z1QXDZEi+H2",
  "tyTdWlEJKtdAhtf/dI4tGL3VI8ks6hBM+ul6rOngFEJRGXprtyZ2W2UMuDdPSCbG",
  "a6MUTk8Nz4GYAlDCZ+cjZIwzjpEn+q/ui7vnw1mzNnFmIQk1jTS/5jYgj1qZOd+q",
  "NhzZeBicVLwfJFCZgSxOJCv37Bqgoa5HXkDsdBUp8xfaGGDP2cHLpLlhPvuVX8fs",
  "tbuQfQRYhw4f2GTHe/nKzg3uAXBYz6+5gx4xonuHuRn8TG09YF/QwuTPM7JqO3H1",
  "W7AzHo4FCvE0B1lrnUWXikZvwCjMIZm9PNSplmQxPqQ8PYoeNs+jFc4CJqGWffW/",
  "U4Bjxx2bAgMBAAECggEACe4mwDWv8r84wbnftS7tnAqIY+opsHvV4u6HA2p90R9D",
  "R4J6gfmdLeGy8fdyvFANB1Tsxx+XYzqQoQkRfFll3q3NMOT2oWMCvsgl9yTpGkf6",
  "kGNJA+o0dEJpwe90cS9P4j313c2E9vV9gcwGdetXiowoD3LNEqZcC3rZgdHNq2S7",
  "f/FmhyosJaTg+L6fTgeWBBzCsdo9WcvPdmGr8CtSe7QK55oOPFZIWdqESJjtdcQm",
  "OgumiE05fy9MsMeez+HMdyr9MX5p/MRqk1g+SITfGVyZnPIp6yfU8+WTWMxQcL7M",
  "oY4vSMjPsfL69kZsMVT9clySdz1KMKz5KtcBKlsczQKBgQDttudUQ5YP/X3fTRWe",
  "m0YE8t9LLCOezY1J0BWZH0XM6Tt/cH8lg6qOHhTNonmX+7AE67vwOiGE5K6vpsNt",
  "dx6+teDXs0f/yaLcfvC9bnOetw2iFNGf/RHl4ADU7YiIcwrrvQz0Me5DFzniNSH+",
  "XYdASgIn+ysealscmDd52C56LwKBgQDmToVFFNJ4Gdm875S1KuXsAk3+AYuJh+rW",
  "pie6T72slndZKBirHpeVlaEGt6OLeSCfBjTwehxpVQF7FPkD2qzFzKcM+GXU7ykw",
  "t6uZmpt101l+8SEY+4qX+dZeB+OYdqbSFnBicJxFCtHUOAjmwJKABaOnRuT1mLJu",
  "Y3QEhik0VQKBgBw2UuobQ1oOebvgyCoUv5CiyoF/cZLNTnFuMsIDhiM1owwS6+Ql",
  "5j4Lr+hf2hKBmnhbCekO3R+KjHjoT9VUB+AWceLnsinXYm7M2gGBdFNn4kRUODTG",
  "sjMYDME4l7WqAafMvhbVPjPUM9h2+dvYec7VecAI/SsU8E9KeXsKfymdAoGBAMhk",
  "8F9ww8YPMD/O88VEA3X9d2GadJEB/BwzzYO3GOKQtl6UngpffySAYvHWXm7gwbq9",
  "itjoV8prVfOEBz0MTKN79Ks7hFfolh2245CvT7ARa+Eh7VuwnCKrGJUPJkGmlHdf",
  "YQC23bLRvEx9SXmHfLH6tjC6ZkUxTajxzqSVHEtVAoGAGEZoozFOjt47D1b3uo1x",
  "0ZXSaC2qsg96vofLKoxuNwCnmm1RuPgvdI4yZeZb28cnCa1S6XW2lyJhCLeMySXd",
  "lqSUbEWGvqHLMPVTDtUANPWRnZr0GaIYKGU+8hJFEu8QcP89O6+SXAUz0bcuVYh3",
  "8B2GJdEPIw1db5/tibqUU1U=",
  "-----END PRIVATE KEY-----",
].join("\n");

export type JwkPublicKey = {
  kty: string;
  n: string;
  e: string;
  kid: string;
  use: string;
  alg: string;
};

/**
 * Derive the JWK public key from a PEM private key.
 * Returns null if the key is invalid or empty.
 */
function deriveJwkFromPem(pem: string): JwkPublicKey | null {
  if (!pem || pem.length < 100) return null;
  try {
    const privKeyObj = crypto.createPrivateKey({ key: pem, format: "pem" });
    const pubKeyObj = crypto.createPublicKey(privKeyObj);
    const jwk = pubKeyObj.export({ format: "jwk" }) as { kty: string; n: string; e: string };
    const der = pubKeyObj.export({ type: "spki", format: "der" }) as Buffer;
    const kid = crypto.createHash("sha256").update(der).digest("hex").slice(0, 16);
    return { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, use: "sig", alg: "RS256" };
  } catch {
    return null;
  }
}

/**
 * Normalise a PEM string that may have been stored with literal \n characters
 * or as a raw base64 body without headers.
 */
function normalisePem(raw: string): string {
  // Already a valid PEM with headers
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  // Literal \n escapes (common when stored in env vars)
  const unescaped = raw.replace(/\\n/g, "\n");
  if (unescaped.includes("-----BEGIN")) return unescaped;
  // Raw base64 body — wrap in PKCS#8 headers
  const body = raw.replace(/\s+/g, "").replace(/\\n/g, "");
  const wrapped = (body.match(/.{1,64}/g) ?? []).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

// Resolve the active private key: prefer JWKS_PRIVATE_KEY env secret, fall back to built-in.
const envRaw = process.env.JWKS_PRIVATE_KEY ?? "";
const envPem = envRaw.length > 100 ? normalisePem(envRaw) : "";
const envKey = envPem ? deriveJwkFromPem(envPem) : null;

if (envKey) {
  log.info(`[JWKS] Using key from JWKS_PRIVATE_KEY secret (kid: ${envKey.kid})`);
} else {
  if (envRaw.length > 0) {
    log.warn("[JWKS] JWKS_PRIVATE_KEY is set but could not be parsed — falling back to built-in key");
  }
}

const builtInKey = deriveJwkFromPem(BUILT_IN_PRIVATE_KEY_PEM);
if (!builtInKey) {
  throw new Error("[JWKS] Built-in private key is invalid — this is a bug, please report it");
}

/** The active JWK public key (env key if valid, otherwise built-in). */
export const ACTIVE_JWK_PUBLIC_KEY: JwkPublicKey = envKey ?? builtInKey;

/** The active private key PEM for signing JWTs. */
export const ACTIVE_PRIVATE_KEY_PEM: string = (envKey && envPem) ? envPem : BUILT_IN_PRIVATE_KEY_PEM;

/**
 * Derive a JWK public key from a PEM-encoded public key (spki format).
 * Used by the key-rotation procedure to return the new public JWK to the caller.
 */
export function derivePublicJwk(publicKeyPem: string): JwkPublicKey {
  const pubKeyObj = crypto.createPublicKey({ key: publicKeyPem, format: "pem" });
  const jwk = pubKeyObj.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  const der = pubKeyObj.export({ type: "spki", format: "der" }) as Buffer;
  const kid = crypto.createHash("sha256").update(der).digest("hex").slice(0, 16);
  return { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, use: "sig", alg: "RS256" };
}
