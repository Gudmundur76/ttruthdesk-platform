/**
 * wikiCompiler.test.ts
 * Tests for entity extraction logic and slug utilities in wikiCompiler.ts
 */

import { describe, it, expect } from "vitest";

// ─── Import helpers directly (no DB/LLM calls in these tests) ─────────────────
import { slugify, wikiKey } from "./wikiCompiler";

describe("wikiCompiler: slugify", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugify("Lysozyme C")).toBe("lysozyme_c");
  });

  it("removes leading and trailing underscores", () => {
    expect(slugify("  Protein  ")).toBe("protein");
  });

  it("collapses multiple non-alphanumeric chars into a single underscore", () => {
    expect(slugify("X-ray Crystallography (2.0Å)")).toBe("x_ray_crystallography_2_0");
  });

  it("truncates at 80 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it("handles PDB IDs correctly", () => {
    expect(slugify("1LYZ")).toBe("1lyz");
    expect(slugify("2HHB")).toBe("2hhb");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles strings with only special chars", () => {
    expect(slugify("---")).toBe("");
  });
});

describe("wikiCompiler: wikiKey", () => {
  it("generates correct S3 key for a PDB ID", () => {
    expect(wikiKey("pdb_id", "1LYZ")).toBe("wiki/pdb_id_1lyz.md");
  });

  it("generates correct S3 key for a protein name", () => {
    expect(wikiKey("protein", "Lysozyme C")).toBe("wiki/protein_lysozyme_c.md");
  });

  it("generates correct S3 key for a method", () => {
    expect(wikiKey("method", "X-ray Crystallography")).toBe(
      "wiki/method_x_ray_crystallography.md"
    );
  });

  it("generates correct S3 key for an organism", () => {
    expect(wikiKey("organism", "Homo sapiens")).toBe("wiki/organism_homo_sapiens.md");
  });

  it("always ends with .md", () => {
    expect(wikiKey("concept", "Protein Folding")).toMatch(/\.md$/);
  });

  it("always starts with wiki/", () => {
    expect(wikiKey("ligand", "ATP")).toMatch(/^wiki\//);
  });
});

describe("wikiCompiler: entity extraction logic", () => {
  // Test the extraction logic inline without importing private functions
  // (they are not exported — we test the observable behavior via slugify/wikiKey)

  it("PDB IDs produce deterministic wiki keys", () => {
    const ids = ["1LYZ", "2HHB", "3NIR"];
    const keys = ids.map((id) => wikiKey("pdb_id", id));
    expect(keys).toEqual([
      "wiki/pdb_id_1lyz.md",
      "wiki/pdb_id_2hhb.md",
      "wiki/pdb_id_3nir.md",
    ]);
  });

  it("same entity name always maps to same key (idempotent)", () => {
    const key1 = wikiKey("protein", "Hemoglobin");
    const key2 = wikiKey("protein", "Hemoglobin");
    expect(key1).toBe(key2);
  });

  it("different entity types with same name produce different keys", () => {
    const k1 = wikiKey("protein", "Lysozyme");
    const k2 = wikiKey("concept", "Lysozyme");
    expect(k1).not.toBe(k2);
  });
});
