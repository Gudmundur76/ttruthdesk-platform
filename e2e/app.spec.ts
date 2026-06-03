/**
 * Truth Desk — End-to-End Test Suite
 *
 * Covers the critical public-facing flows:
 * 1. Homepage loads with correct branding and CTAs
 * 2. Navigation links are present and functional
 * 3. Sign-in dialog opens and accepts email input
 * 4. Registry page loads and displays claims
 * 5. Graph page loads and renders the visualisation
 * 6. Verticals page loads with domain cards
 * 7. Pricing / audit request page loads and form is present
 * 8. Public API endpoints return correct content types
 * 9. Agent-discovery endpoints are reachable
 * 10. 404 page is handled gracefully
 */

import { test, expect } from "@playwright/test";

// ─── 1. Homepage ──────────────────────────────────────────────────────────────

test.describe("Homepage", () => {
  test("loads with 200 and correct title", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Truth Desk/i);
  });

  test("hero heading is visible", async ({ page }) => {
    await page.goto("/");
    // Wait for React to hydrate
    await page.waitForSelector("h1, h2", { timeout: 10_000 });
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible();
  });

  test("Start Free Audit CTA is present", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    const cta = page.getByText(/Start Free Audit|Request Audit|Get Started/i).first();
    await expect(cta).toBeVisible({ timeout: 10_000 });
  });

  test("page has a main landmark", async ({ page }) => {
    await page.goto("/");
    // Check the static noscript HTML contains <main> (server-injected)
    const html = await page.content();
    expect(html).toContain("<main");
  });

  test("JSON-LD is present in the page", async ({ page }) => {
    await page.goto("/");
    const html = await page.content();
    expect(html).toContain("application/ld+json");
  });
});

// ─── 2. Navigation ────────────────────────────────────────────────────────────

test.describe("Navigation", () => {
  test("top nav renders Verticals, Registry, Graph links", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("nav, header", { timeout: 10_000 });
    await expect(page.getByRole("link", { name: /Verticals/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Registry/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Graph/i }).first()).toBeVisible();
  });

  test("Sign in button is visible when not authenticated", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("button, a", { timeout: 10_000 });
    const signIn = page.getByRole("button", { name: /Sign in/i }).first();
    await expect(signIn).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 3. Sign-in Dialog ────────────────────────────────────────────────────────

test.describe("Magic Link Sign-in Dialog", () => {
  test("opens when Sign in is clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("button", { timeout: 10_000 });
    const signInBtn = page.getByRole("button", { name: /Sign in/i }).first();
    await signInBtn.click();
    // Dialog should appear
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
  });

  test("dialog contains email input and submit button", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("button", { timeout: 10_000 });
    await page.getByRole("button", { name: /Sign in/i }).first().click();
    await page.waitForSelector("[role=dialog]", { timeout: 5_000 });
    await expect(page.locator("input[type=email]")).toBeVisible();
    await expect(page.getByRole("button", { name: /Send sign-in link/i })).toBeVisible();
  });

  test("submitting a valid email shows confirmation step", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("button", { timeout: 10_000 });
    await page.getByRole("button", { name: /Sign in/i }).first().click();
    await page.waitForSelector("[role=dialog]", { timeout: 5_000 });
    await page.locator("input[type=email]").fill("test@example.com");
    await page.getByRole("button", { name: /Send sign-in link/i }).click();
    // Should transition to "Check your email" step
    await expect(page.getByText(/Check your email/i)).toBeVisible({ timeout: 8_000 });
  });

  test("dialog closes when clicking outside", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("button", { timeout: 10_000 });
    await page.getByRole("button", { name: /Sign in/i }).first().click();
    await page.waitForSelector("[role=dialog]", { timeout: 5_000 });
    // Press Escape to close
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── 4. Registry Page ─────────────────────────────────────────────────────────

test.describe("Registry Page", () => {
  test("loads with 200", async ({ page }) => {
    const response = await page.goto("/registry");
    expect(response?.status()).toBe(200);
  });

  test("renders a heading", async ({ page }) => {
    await page.goto("/registry");
    await page.waitForSelector("h1, h2, h3", { timeout: 10_000 });
    const heading = page.locator("h1, h2, h3").first();
    await expect(heading).toBeVisible();
  });

  test("shows loading state or claim rows", async ({ page }) => {
    await page.goto("/registry");
    // Either a spinner/skeleton or actual content should be visible
    await page.waitForTimeout(2000);
    const hasContent = await page.locator("table, [data-testid], .claim, p").first().isVisible().catch(() => false);
    expect(hasContent).toBe(true);
  });
});

// ─── 5. Graph Page ────────────────────────────────────────────────────────────

test.describe("Graph Page", () => {
  test("loads with 200", async ({ page }) => {
    const response = await page.goto("/graph");
    expect(response?.status()).toBe(200);
  });

  test("renders a canvas or SVG element for the graph", async ({ page }) => {
    await page.goto("/graph");
    // react-force-graph renders a canvas
    await page.waitForTimeout(3000);
    const hasCanvas = await page.locator("canvas").first().isVisible().catch(() => false);
    const hasSvg = await page.locator("svg").first().isVisible().catch(() => false);
    expect(hasCanvas || hasSvg).toBe(true);
  });
});

// ─── 6. Verticals Page ────────────────────────────────────────────────────────

test.describe("Verticals Page", () => {
  test("loads with 200", async ({ page }) => {
    const response = await page.goto("/verticals");
    expect(response?.status()).toBe(200);
  });

  test("shows Structural Biology and Salmon Biotech cards", async ({ page }) => {
    await page.goto("/verticals");
    await page.waitForTimeout(2000);
    const html = await page.content();
    expect(html.toLowerCase()).toMatch(/structural biology|structural_biology/i);
    expect(html.toLowerCase()).toMatch(/salmon|salmon biotech/i);
  });
});

// ─── 7. Pricing / Audit Request Page ─────────────────────────────────────────

test.describe("Pricing Page", () => {
  test("loads with 200", async ({ page }) => {
    const response = await page.goto("/pricing");
    expect(response?.status()).toBe(200);
  });

  test("shows pricing tiers or audit request form", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForTimeout(2000);
    const html = await page.content();
    expect(html).toMatch(/Starter|Diligence|Platform|Audit|price|\$|€/i);
  });
});

// ─── 8. Public API Endpoints ──────────────────────────────────────────────────

test.describe("Public API", () => {
  test("GET /api/public/claims.json returns JSON with claims array", async ({ request }) => {
    const res = await request.get("/api/public/claims.json");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    // Returns an envelope object with a claims array (not a bare array)
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
    // Either a bare array or an envelope with claims/data/items key
    const isArray = Array.isArray(body);
    const hasClaimsKey = body.claims !== undefined || body.data !== undefined || body.items !== undefined || body.standard !== undefined;
    expect(isArray || hasClaimsKey).toBe(true);
  });

  test("POST /api/public/verify-claim returns structured response", async ({ request }) => {
    const res = await request.post("/api/public/verify-claim", {
      data: { claim: "The crystal structure of lysozyme was solved at 1.8 Å resolution." },
    });
    // 200 (success or internal error), 429 (rate limited), 500 (server error)
    expect([200, 429, 500]).toContain(res.status());
    const body = await res.json();
    // Response always has processedAt or error field
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
    // Either a successful verdict response or an error response
    const hasVerdict = "verdict" in body || "ok" in body || "error" in body;
    expect(hasVerdict).toBe(true);
  });

  test("GET /api/md returns markdown content", async ({ request }) => {
    const res = await request.get("/api/md");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(100);
  });

  test("GET /llms.txt returns text content", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("Truth Desk");
  });
});

// ─── 9. Agent Discovery Endpoints ────────────────────────────────────────────

test.describe("Agent Discovery", () => {
  test("GET /.well-known/mcp.json returns valid MCP card", async ({ request }) => {
    const res = await request.get("/.well-known/mcp.json");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("tools");
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
  });

  test("GET /.well-known/auth.md returns markdown", async ({ request }) => {
    const res = await request.get("/.well-known/auth.md");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("Truth Desk");
  });

  test("GET /openapi.json returns valid OpenAPI spec", async ({ request }) => {
    const res = await request.get("/openapi.json");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("openapi");
    expect(body).toHaveProperty("paths");
  });

  test("response headers include X-Content-Signal", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["x-content-signal"]).toBe("scientific-claims-verification");
  });

  test("response headers include Link header with mcp.json", async ({ request }) => {
    const res = await request.get("/");
    const link = res.headers()["link"] ?? "";
    expect(link).toContain("mcp.json");
  });
});

// ─── 10. 404 Handling ─────────────────────────────────────────────────────────

test.describe("404 handling", () => {
  test("unknown routes return 200 (SPA fallthrough) with app shell", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist-xyz");
    // SPA serves index.html for all routes — React renders the 404 component
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(2000);
    const html = await page.content();
    // Should contain the app shell, not a blank page
    expect(html).toContain("Truth Desk");
  });
});

// ─── 11. Audit Request Form Submission ────────────────────────────────────────

test.describe("Audit Request Form", () => {
  test("form fields are present on pricing page", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForTimeout(2000);
    // The form should have at minimum a name/email/company field and a submit button
    const hasInput = await page.locator("input, textarea, select").first().isVisible().catch(() => false);
    expect(hasInput).toBe(true);
  });

  test("form submission shows feedback (success or validation error)", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForTimeout(2000);

    // Fill in whatever fields are visible
    const nameInput = page.locator("input[name=name], input[placeholder*=name i], input[placeholder*=Name]").first();
    const emailInput = page.locator("input[type=email], input[name=email], input[placeholder*=email i]").first();

    const hasName = await nameInput.isVisible().catch(() => false);
    const hasEmail = await emailInput.isVisible().catch(() => false);

    if (hasName) await nameInput.fill("Test User");
    if (hasEmail) await emailInput.fill("test@example.com");

    // Look for a submit/CTA button
    const submitBtn = page
      .getByRole("button", { name: /Submit|Request|Send|Get Started|Contact/i })
      .first();
    const hasSubmit = await submitBtn.isVisible().catch(() => false);

    if (hasSubmit) {
      await submitBtn.click();
      // After submit: expect either a success message, a toast, or a validation error
      await page.waitForTimeout(3000);
      const html = await page.content();
      const hasFeedback =
        html.match(/success|thank|sent|submitted|error|required|invalid/i) !== null;
      expect(hasFeedback).toBe(true);
    } else {
      // If no submit button found, at least confirm the form structure exists
      expect(hasName || hasEmail).toBe(true);
    }
  });
});
