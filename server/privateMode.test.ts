/**
 * privateMode.test.ts
 * Unit tests for server/privateMode.ts — pure function tests
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("generateDockerCompose()", () => {
  it("generates valid docker-compose YAML with required services", async () => {
    const { generateDockerCompose } = await import("./privateMode");
    const result = generateDockerCompose({
      verticalKey: "structural_biology",
      domain: "example.com",
    });
    expect(result).toContain("version:");
    expect(result).toContain("services:");
    expect(result).toContain("truthdesk");
    expect(result).toContain("example.com");
  });

  it("includes database service in output when includeLocalDb is true", async () => {
    const { generateDockerCompose } = await import("./privateMode");
    const result = generateDockerCompose({
      verticalKey: "structural_biology",
      domain: "test.io",
      includeLocalDb: true,
    });
    expect(result).toContain("mysql");
  });

  it("uses provided domain in configuration", async () => {
    const { generateDockerCompose } = await import("./privateMode");
    const result = generateDockerCompose({
      verticalKey: "structural_biology",
      domain: "mycompany.internal",
    });
    expect(result).toContain("mycompany.internal");
  });
});

describe("generateNginxConfig()", () => {
  it("generates nginx config with domain and proxy_pass", async () => {
    const { generateNginxConfig } = await import("./privateMode");
    const result = generateNginxConfig({ domain: "example.com" });
    expect(result).toContain("server_name example.com");
    expect(result).toContain("proxy_pass");
    expect(result).toContain("listen 443");
  });

  it("uses default port 3000 when hostPort not specified", async () => {
    const { generateNginxConfig } = await import("./privateMode");
    const result = generateNginxConfig({ domain: "example.com" });
    expect(result).toContain(":3000");
  });

  it("uses custom port when hostPort is specified", async () => {
    const { generateNginxConfig } = await import("./privateMode");
    const result = generateNginxConfig({ domain: "example.com", hostPort: 8080 });
    expect(result).toContain(":8080");
  });
});

describe("generateSamlConfig()", () => {
  it("generates SAML config with required fields", async () => {
    const { generateSamlConfig } = await import("./privateMode");
    const result = generateSamlConfig({
      domain: "example.com",
      idpEntryPoint: "https://idp.example.com/sso",
      idpCert: "MIIB...",
    });
    expect(result.issuer).toContain("example.com");
    expect(result.entryPoint).toContain("idp.example.com");
    expect(result.callbackUrl).toContain("/api/auth/saml/callback");
  });
});

describe("AdapterRegistry", () => {
  it("registers and retrieves an adapter by ID", async () => {
    const { registerAdapter, getAdapter } = await import("./privateMode");
    const mockAdapter = {
      adapterId: "test_adapter_xyz",
      displayName: "Test Adapter",
      verticals: ["structural_biology"],
      healthCheck: vi.fn().mockResolvedValue(true),
      search: vi.fn().mockResolvedValue([]),
      fetchById: vi.fn().mockResolvedValue(null),
    };
    registerAdapter(mockAdapter);
    const retrieved = getAdapter("test_adapter_xyz");
    expect(retrieved).toBe(mockAdapter);
  });

  it("returns undefined for unknown adapter ID", async () => {
    const { getAdapter } = await import("./privateMode");
    const result = getAdapter("nonexistent_adapter_abc");
    expect(result).toBeUndefined();
  });

  it("getAdaptersForVertical returns adapters matching vertical", async () => {
    const { registerAdapter, getAdaptersForVertical } = await import("./privateMode");
    const mockAdapter = {
      adapterId: "vertical_test_adapter",
      displayName: "Vertical Test",
      verticals: ["test_vertical_123"],
      healthCheck: vi.fn().mockResolvedValue(true),
      search: vi.fn().mockResolvedValue([]),
      fetchById: vi.fn().mockResolvedValue(null),
    };
    registerAdapter(mockAdapter);
    const results = getAdaptersForVertical("test_vertical_123");
    expect(results.some((a) => a.adapterId === "vertical_test_adapter")).toBe(true);
  });
});
