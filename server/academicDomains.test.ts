import { describe, it, expect } from "vitest";
import { isAcademicEmail, getPlanForEmail, checkAuditLimit } from "./academicDomains";

describe("isAcademicEmail", () => {
  it("detects .edu domains", () => {
    expect(isAcademicEmail("student@mit.edu")).toBe(true);
    expect(isAcademicEmail("researcher@stanford.edu")).toBe(true);
    expect(isAcademicEmail("pi@harvard.edu")).toBe(true);
  });

  it("detects .ac.uk domains", () => {
    expect(isAcademicEmail("user@ox.ac.uk")).toBe(true);
    expect(isAcademicEmail("user@cam.ac.uk")).toBe(true);
    expect(isAcademicEmail("user@imperial.ac.uk")).toBe(true);
  });

  it("detects Icelandic university domains", () => {
    expect(isAcademicEmail("student@hi.is")).toBe(true);
    expect(isAcademicEmail("researcher@ru.is")).toBe(true);
    expect(isAcademicEmail("user@unak.is")).toBe(true);
    expect(isAcademicEmail("user@bifrost.is")).toBe(true);
    expect(isAcademicEmail("user@lbhi.is")).toBe(true);
    expect(isAcademicEmail("user@holar.is")).toBe(true);
  });

  it("detects .ac.nz, .ac.jp, .ac.in domains", () => {
    expect(isAcademicEmail("user@auckland.ac.nz")).toBe(true);
    expect(isAcademicEmail("user@u-tokyo.ac.jp")).toBe(true);
    expect(isAcademicEmail("user@iitb.ac.in")).toBe(true);
  });

  it("detects known Canadian universities", () => {
    expect(isAcademicEmail("user@utoronto.ca")).toBe(true);
    expect(isAcademicEmail("user@mcgill.ca")).toBe(true);
    expect(isAcademicEmail("user@ubc.ca")).toBe(true);
  });

  it("detects known German universities", () => {
    expect(isAcademicEmail("user@tum.de")).toBe(true);
    expect(isAcademicEmail("user@lmu.de")).toBe(true);
    expect(isAcademicEmail("user@fu-berlin.de")).toBe(true);
  });

  it("detects research institutes", () => {
    expect(isAcademicEmail("user@broadinstitute.org")).toBe(true);
    expect(isAcademicEmail("user@cshl.edu")).toBe(true);
    expect(isAcademicEmail("user@embl.de")).toBe(true);
  });

  it("rejects commercial email domains", () => {
    expect(isAcademicEmail("user@gmail.com")).toBe(false);
    expect(isAcademicEmail("user@outlook.com")).toBe(false);
    expect(isAcademicEmail("user@biotech-startup.com")).toBe(false);
    expect(isAcademicEmail("user@vcfirm.io")).toBe(false);
  });

  it("rejects malformed emails", () => {
    expect(isAcademicEmail("notanemail")).toBe(false);
    expect(isAcademicEmail("")).toBe(false);
    expect(isAcademicEmail("@")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isAcademicEmail("User@MIT.EDU")).toBe(true);
    expect(isAcademicEmail("STUDENT@HI.IS")).toBe(true);
  });
});

describe("getPlanForEmail", () => {
  it("assigns academic plan with no expiry for university emails", () => {
    const result = getPlanForEmail("researcher@ox.ac.uk");
    expect(result.plan).toBe("academic");
    expect(result.trialExpiresAt).toBeNull();
  });

  it("assigns free_trial plan with 30-day expiry for commercial emails", () => {
    const result = getPlanForEmail("user@gmail.com");
    expect(result.plan).toBe("free_trial");
    expect(result.trialExpiresAt).toBeInstanceOf(Date);
    // Should expire in ~30 days
    const daysUntilExpiry = (result.trialExpiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysUntilExpiry).toBeGreaterThan(29);
    expect(daysUntilExpiry).toBeLessThan(31);
  });
});

describe("checkAuditLimit", () => {
  it("allows academic users unlimited audits", () => {
    expect(checkAuditLimit({ plan: "academic", trialExpiresAt: null, auditCount: 9999 }).allowed).toBe(true);
  });

  it("allows platform users unlimited audits", () => {
    expect(checkAuditLimit({ plan: "platform", trialExpiresAt: null, auditCount: 9999 }).allowed).toBe(true);
  });

  it("allows free_trial users within limit", () => {
    const expiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days from now
    expect(checkAuditLimit({ plan: "free_trial", trialExpiresAt: expiry, auditCount: 0 }).allowed).toBe(true);
    expect(checkAuditLimit({ plan: "free_trial", trialExpiresAt: expiry, auditCount: 2 }).allowed).toBe(true);
  });

  it("blocks free_trial users who have used 3 audits", () => {
    const expiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const result = checkAuditLimit({ plan: "free_trial", trialExpiresAt: expiry, auditCount: 3 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("3 audits");
  });

  it("blocks free_trial users whose trial has expired", () => {
    const expiry = new Date(Date.now() - 1000); // 1 second ago
    const result = checkAuditLimit({ plan: "free_trial", trialExpiresAt: expiry, auditCount: 0 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("allows starter users within 10-audit limit", () => {
    expect(checkAuditLimit({ plan: "starter", trialExpiresAt: null, auditCount: 9 }).allowed).toBe(true);
  });

  it("blocks starter users at 10 audits", () => {
    const result = checkAuditLimit({ plan: "starter", trialExpiresAt: null, auditCount: 10 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("10-audit");
  });

  it("allows diligence users within 50-audit limit", () => {
    expect(checkAuditLimit({ plan: "diligence", trialExpiresAt: null, auditCount: 49 }).allowed).toBe(true);
  });

  it("blocks diligence users at 50 audits", () => {
    const result = checkAuditLimit({ plan: "diligence", trialExpiresAt: null, auditCount: 50 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("50-audit");
  });
});
