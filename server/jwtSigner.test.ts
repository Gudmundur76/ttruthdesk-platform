/**
 * Tests for server/jwtSigner.ts
 *
 * Validates:
 * 1. signJwt produces a valid RS256 JWT
 * 2. verifyJwt accepts a valid token and returns the payload
 * 3. verifyJwt rejects expired tokens
 * 4. verifyJwt rejects tampered tokens
 * 5. verifyJwt rejects wrong audience
 * 6. issueApiToken / verifyApiToken round-trip
 * 7. The kid in the header matches ACTIVE_JWK_PUBLIC_KEY.kid
 */

import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt, issueApiToken, verifyApiToken } from "./jwtSigner";
import { ACTIVE_JWK_PUBLIC_KEY } from "./jwksKeys";

describe("jwtSigner", () => {
  it("signJwt produces a three-part JWT string", async () => {
    const token = await signJwt({ sub: "user_1", role: "admin" });
    expect(typeof token).toBe("string");
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  it("JWT header contains alg=RS256 and the active kid", async () => {
    const token = await signJwt({ sub: "user_1" });
    const headerB64 = token.split(".")[0];
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe(ACTIVE_JWK_PUBLIC_KEY.kid);
  });

  it("verifyJwt returns the original payload fields", async () => {
    const token = await signJwt({ sub: "user_42", role: "reader", extra: "data" });
    const payload = await verifyJwt(token);
    expect(payload.sub).toBe("user_42");
    expect(payload.role).toBe("reader");
    expect(payload.extra).toBe("data");
  });

  it("verifyJwt sets iss and exp claims automatically", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub: "u1" }, { expiresIn: "1h" });
    const payload = await verifyJwt(token);
    const after = Math.floor(Date.now() / 1000);
    expect(payload.iss).toBe("ttruthdesk.claims");
    expect(typeof payload.exp).toBe("number");
    expect(payload.exp as number).toBeGreaterThan(before + 3590);
    expect(payload.iat as number).toBeGreaterThanOrEqual(before);
    expect(payload.iat as number).toBeLessThanOrEqual(after);
  });

  it("verifyJwt rejects a tampered token", async () => {
    const token = await signJwt({ sub: "user_1" });
    const parts = token.split(".");
    // Flip a byte in the signature
    const badSig = parts[2].slice(0, -4) + "AAAA";
    const tampered = `${parts[0]}.${parts[1]}.${badSig}`;
    await expect(verifyJwt(tampered)).rejects.toThrow();
  });

  it("verifyJwt rejects an expired token", async () => {
    const token = await signJwt({ sub: "user_1" }, { expiresIn: "1s" });
    // Wait 1.5 seconds for the token to expire
    await new Promise((r) => setTimeout(r, 1500));
    await expect(verifyJwt(token)).rejects.toThrow();
  }, 10_000);

  it("verifyJwt rejects wrong audience", async () => {
    const token = await signJwt({ sub: "u1" }, { audience: "service-a" });
    await expect(verifyJwt(token, { audience: "service-b" })).rejects.toThrow();
  });

  it("verifyJwt accepts correct audience", async () => {
    const token = await signJwt({ sub: "u1" }, { audience: "service-a" });
    const payload = await verifyJwt(token, { audience: "service-a" });
    expect(payload.sub).toBe("u1");
  });

  describe("issueApiToken / verifyApiToken", () => {
    it("round-trips sub, scope, and label", async () => {
      const token = await issueApiToken({
        sub: "42",
        scope: "read write",
        label: "my-key",
      });
      const payload = await verifyApiToken(token);
      expect(payload.sub).toBe("42");
      expect(payload.scope).toBe("read write");
      expect(payload.label).toBe("my-key");
    });

    it("uses ttruthdesk.claims/api as audience", async () => {
      const token = await issueApiToken({ sub: "1", scope: "read" });
      // Verify with correct audience — should not throw
      const payload = await verifyApiToken(token);
      expect(payload.sub).toBe("1");
    });

    it("rejects a token with wrong audience", async () => {
      // Sign with a different audience
      const token = await signJwt({ sub: "1", scope: "read", label: "" }, { audience: "other-service" });
      await expect(verifyApiToken(token)).rejects.toThrow();
    });

    it("default expiry is 365 days", async () => {
      const before = Math.floor(Date.now() / 1000);
      const token = await issueApiToken({ sub: "1", scope: "read" });
      const payload = await verifyApiToken(token);
      const expectedExp = before + 365 * 24 * 3600;
      expect(payload as unknown as { exp: number }).toMatchObject({});
      // Decode without verifying to check exp
      const raw = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      expect(raw.exp).toBeGreaterThanOrEqual(expectedExp - 5);
      expect(raw.exp).toBeLessThanOrEqual(expectedExp + 5);
    });
  });
});
