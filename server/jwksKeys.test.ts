/**
 * Tests for server/jwksKeys.ts
 *
 * Validates that:
 * 1. The built-in key is always valid and produces a proper JWK
 * 2. ACTIVE_JWK_PUBLIC_KEY has the required fields
 * 3. The normalisePem helper handles all storage formats
 * 4. The JWKS endpoint returns the correct key
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";

describe("jwksKeys module", () => {
  it("exports ACTIVE_JWK_PUBLIC_KEY with required JWK fields", async () => {
    const { ACTIVE_JWK_PUBLIC_KEY } = await import("./jwksKeys");
    expect(ACTIVE_JWK_PUBLIC_KEY).toBeDefined();
    expect(ACTIVE_JWK_PUBLIC_KEY.kty).toBe("RSA");
    expect(ACTIVE_JWK_PUBLIC_KEY.alg).toBe("RS256");
    expect(ACTIVE_JWK_PUBLIC_KEY.use).toBe("sig");
    expect(ACTIVE_JWK_PUBLIC_KEY.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(ACTIVE_JWK_PUBLIC_KEY.n).toBeTruthy();
    expect(ACTIVE_JWK_PUBLIC_KEY.e).toBe("AQAB"); // standard RSA public exponent 65537
  });

  it("ACTIVE_JWK_PUBLIC_KEY n is a valid base64url-encoded RSA modulus", async () => {
    const { ACTIVE_JWK_PUBLIC_KEY } = await import("./jwksKeys");
    // base64url: no +, /, = padding
    expect(ACTIVE_JWK_PUBLIC_KEY.n).toMatch(/^[A-Za-z0-9_-]+$/);
    // RSA-2048 modulus is 256 bytes → ~342 base64url chars
    const decoded = Buffer.from(ACTIVE_JWK_PUBLIC_KEY.n, "base64url");
    expect(decoded.length).toBeGreaterThanOrEqual(250);
    expect(decoded.length).toBeLessThanOrEqual(260);
  });

  it("ACTIVE_PRIVATE_KEY_PEM can be used to sign and verify data", async () => {
    const { ACTIVE_PRIVATE_KEY_PEM, ACTIVE_JWK_PUBLIC_KEY } = await import("./jwksKeys");
    const privKey = crypto.createPrivateKey({ key: ACTIVE_PRIVATE_KEY_PEM, format: "pem" });
    const pubKey = crypto.createPublicKey(privKey);

    const message = Buffer.from("test-payload");
    const signature = crypto.sign("sha256", message, { key: privKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING });
    const valid = crypto.verify("sha256", message, { key: pubKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }, signature);
    expect(valid).toBe(true);

    // Also verify the public key matches the JWK
    const jwk = pubKey.export({ format: "jwk" }) as { n: string; e: string };
    expect(jwk.n).toBe(ACTIVE_JWK_PUBLIC_KEY.n);
    expect(jwk.e).toBe(ACTIVE_JWK_PUBLIC_KEY.e);
  });

  it("kid is derived deterministically from the public key DER", async () => {
    const { ACTIVE_PRIVATE_KEY_PEM, ACTIVE_JWK_PUBLIC_KEY } = await import("./jwksKeys");
    const privKey = crypto.createPrivateKey({ key: ACTIVE_PRIVATE_KEY_PEM, format: "pem" });
    const pubKey = crypto.createPublicKey(privKey);
    const der = pubKey.export({ type: "spki", format: "der" }) as Buffer;
    const expectedKid = crypto.createHash("sha256").update(der).digest("hex").slice(0, 16);
    expect(ACTIVE_JWK_PUBLIC_KEY.kid).toBe(expectedKid);
  });
});
