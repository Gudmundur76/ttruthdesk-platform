/**
 * searchEngine.test.ts — imports from the real module.
 */
import { describe, it, expect } from "vitest";
import { tokenise } from "./searchEngine";

describe("tokenise", () => {
  it("returns empty array for empty string", () => { expect(tokenise("")).toEqual([]); });
  it("lowercases all tokens", () => {
    const t = tokenise("LYSOZYME PROTEIN");
    expect(t).toContain("lysozyme"); expect(t).toContain("protein");
  });
  it("removes tokens shorter than 3 characters", () => {
    const t = tokenise("a ab abc abcd");
    expect(t).not.toContain("a"); expect(t).not.toContain("ab");
    expect(t).toContain("abc"); expect(t).toContain("abcd");
  });
  it("filters out stop words", () => {
    expect(tokenise("the and for are but not you all can")).toHaveLength(0);
  });
  it("keeps non-stop-word tokens of length >= 3", () => {
    const t = tokenise("lysozyme resolution crystal");
    expect(t).toContain("lysozyme"); expect(t).toContain("resolution"); expect(t).toContain("crystal");
  });
  it("removes special characters", () => {
    const t = tokenise("1LYZ!@#$%^&*()protein");
    expect(t).toContain("1lyz"); expect(t).toContain("protein");
  });
  it("handles hyphens in tokens", () => {
    expect(tokenise("anti-microbial")).toContain("anti-microbial");
  });
  it("caps output at 8 tokens", () => {
    const t = tokenise("alpha beta gamma delta epsilon zeta eta theta iota kappa");
    expect(t.length).toBeLessThanOrEqual(8);
  });
  it("splits on whitespace correctly", () => {
    const t = tokenise("  lysozyme   protein  ");
    expect(t).toContain("lysozyme"); expect(t).toContain("protein"); expect(t).toHaveLength(2);
  });
  it("filters the stop word with", () => {
    const t = tokenise("protein with structure");
    expect(t).not.toContain("with");
  });
  it("returns deterministic results", () => {
    expect(tokenise("lysozyme crystal structure")).toEqual(tokenise("lysozyme crystal structure"));
  });
});
