import { z } from "zod";

/** Escape LIKE wildcard characters to prevent wildcard injection. */
const escapeLike = (s: string) => s.replace(/[%_\\]/g, c => `\\${c}`);
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createDocument,
  getDocumentById,
  getDocumentsByUser,
  getClaimsByDocument,
  overrideClaimVerdict,
  getAuditReportByDocument,
  createAuditRequest,
  getAllAuditRequests,
  markAuditRequestOwnerNotified,
  getMonitoringFeedByDocument,
  getAllMonitoringFeed,
  insertMonitoringItems,
  getGraphData,
  getVerticalStats,
  getRecentAuditRequestsByEmail,
  getAllGraphEntities,
  getAllGraphRelations,
  getContradictionRelations,
  getCorpusGrowthStats,
} from "./db";
import { invokeLLM } from "./_core/llm";
import { fetchWikiPage } from "./wikiCompiler";
import { checkAuditLimit } from "./academicDomains";
import { getEmailUserById, incrementEmailUserAuditCount } from "./db";
import { notifyOwner } from "./_core/notification";
import { runAnalysisPipeline } from "./analysisPipeline";
import { storagePut } from "./storage";
import { translateQueryToClaims } from "./_queryTranslator";
import { verdictForClaim } from "./pdbAdapter";
import { triggerAutonomousIngest, type PubMedResult } from "./autonomousIngest";

// ─── EuropePMC helper (used by chat.query) ────────────────────────────────────
const EUROPE_PMC_SEARCH =
  "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
async function fetchPubMedResults(
  query: string,
  limit = 5
): Promise<PubMedResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `${EUROPE_PMC_SEARCH}?query=${encoded}&format=json&pageSize=${limit}&resultType=core&sort=CITED+desc`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      resultList?: {
        result?: Array<{
          pmid?: string;
          id?: string;
          title?: string;
          abstractText?: string;
          authorString?: string;
          journalTitle?: string;
          pubYear?: string;
        }>;
      };
    };
    const results = data.resultList?.result ?? [];
    return results
      .slice(0, limit)
      .map(r => ({
        pmid: r.pmid ?? r.id ?? "",
        title: r.title ?? "Untitled",
        abstractSnippet: (r.abstractText ?? "").slice(0, 400),
        citationUrl: r.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
          : `https://europepmc.org/article/MED/${r.id ?? ""}`,
        authors: r.authorString ? r.authorString.split(", ").slice(0, 5) : [],
        journal: r.journalTitle ?? undefined,
        year: r.pubYear ? parseInt(r.pubYear, 10) : undefined,
      }))
      .filter(r => r.pmid);
  } catch {
    return [];
  }
}

// ─── Router ────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Documents ─────────────────────────────────────────────────────────────
  documents: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getDocumentsByUser(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.id);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        return doc;
      }),

    submitText: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(512),
          text: z.string().min(10).max(500_000), // ~125k tokens max — DoS guard
          /** Optional: FrictionEngine pre-submission scan result to persist alongside the document */
          preflightResult: z.unknown().optional(),
          /** Verification domain — determines which adapter is used for claim verdicts */
          verticalDomain: z.string().max(64).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Plan enforcement for email users
        if (ctx.user.openId?.startsWith("email_")) {
          const emailUserId = parseInt(
            ctx.user.openId.replace("email_", ""),
            10
          );
          const emailUser = await getEmailUserById(emailUserId);
          if (emailUser) {
            const limit = checkAuditLimit(emailUser);
            if (!limit.allowed) {
              throw new TRPCError({ code: "FORBIDDEN", message: limit.reason });
            }
          }
        }
        const docId = await createDocument({
          userId: ctx.user.id,
          title: input.title,
          sourceType: "paste",
          rawText: input.text,
          verticalDomain: input.verticalDomain ?? "structural_biology",
          preflightResult: input.preflightResult ?? null,
        });
        // Increment audit count for email users
        if (ctx.user.openId?.startsWith("email_")) {
          const emailUserId = parseInt(
            ctx.user.openId.replace("email_", ""),
            10
          );
          await incrementEmailUserAuditCount(emailUserId).catch(() => {});
        }
        // Run pipeline async (fire and forget)
        runAnalysisPipeline(docId, input.text, ctx.user.id).catch(
          console.error
        );
        // Publish to autonomous loop event bus (fire and forget)
        import("./autonomousLoop/eventBus")
          .then(({ publishEvent }) =>
            publishEvent("document_submitted", {
              documentId: docId,
              userId: ctx.user.id,
              sourceType: "paste",
            }).catch(() => {})
          )
          .catch(() => {});
        return { documentId: docId };
      }),

    submitFile: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(512),
          fileName: z.string(),
          storageKey: z.string(),
          storageUrl: z.string(),
          rawText: z.string().max(500_000), // ~125k tokens max — DoS guard
          /** Optional: FrictionEngine pre-submission scan result to persist alongside the document */
          preflightResult: z.unknown().optional(),
          /** Verification domain — determines which adapter is used for claim verdicts */
          verticalDomain: z.string().max(64).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Plan enforcement for email users
        if (ctx.user.openId?.startsWith("email_")) {
          const emailUserId = parseInt(
            ctx.user.openId.replace("email_", ""),
            10
          );
          const emailUser = await getEmailUserById(emailUserId);
          if (emailUser) {
            const limit = checkAuditLimit(emailUser);
            if (!limit.allowed) {
              throw new TRPCError({ code: "FORBIDDEN", message: limit.reason });
            }
          }
        }
        const docId = await createDocument({
          userId: ctx.user.id,
          title: input.title,
          sourceType: "upload",
          originalFileName: input.fileName,
          storageKey: input.storageKey,
          storageUrl: input.storageUrl,
          rawText: input.rawText,
          verticalDomain: input.verticalDomain ?? "structural_biology",
          preflightResult: input.preflightResult ?? null,
        });
        // Increment audit count for email users
        if (ctx.user.openId?.startsWith("email_")) {
          const emailUserId = parseInt(
            ctx.user.openId.replace("email_", ""),
            10
          );
          await incrementEmailUserAuditCount(emailUserId).catch(() => {});
        }
        runAnalysisPipeline(docId, input.rawText, ctx.user.id).catch(
          console.error
        );
        // Publish to autonomous loop event bus (fire and forget)
        import("./autonomousLoop/eventBus")
          .then(({ publishEvent }) =>
            publishEvent("document_submitted", {
              documentId: docId,
              userId: ctx.user.id,
              sourceType: "upload",
            }).catch(() => {})
          )
          .catch(() => {});
        return { documentId: docId };
      }),

    /**
     * Fetch a public academic paper by PMID, DOI, or PubMed URL.
     * Returns the title + concatenated abstract/methods text ready to submit.
     * Uses PubMed E-utilities (free, no API key required) with Europe PMC as fallback.
     */
    fetchFromPubmed: protectedProcedure
      .input(
        z.object({
          query: z
            .string()
            .min(1)
            .max(512)
            .describe("PMID, DOI, or PubMed URL"),
        })
      )
      .mutation(async ({ input }) => {
        const raw = input.query.trim();

        // ── Normalise to PMID or DOI ──────────────────────────────────────────
        let pmid: string | null = null;
        let doi: string | null = null;

        // PubMed URL: https://pubmed.ncbi.nlm.nih.gov/12345678/
        const pmidFromUrl = raw.match(/pubmed\.ncbi\.nlm\.nih\.gov\/([0-9]+)/i);
        if (pmidFromUrl) pmid = pmidFromUrl[1];

        // Bare PMID (all digits)
        if (!pmid && /^[0-9]{4,12}$/.test(raw)) pmid = raw;

        // DOI: 10.xxxx/... or https://doi.org/10.xxxx/...
        const doiMatch = raw.match(/(10\.[0-9]{4,}\/.+)/i);
        if (!pmid && doiMatch) doi = doiMatch[1].replace(/\/$/, "");

        if (!pmid && !doi) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Please enter a valid PubMed ID (e.g. 37234567), DOI (e.g. 10.1038/s41586-023-06415-8), or PubMed URL.",
          });
        }

        // ── Fetch via PubMed E-utilities ──────────────────────────────────────
        try {
          // If we have a DOI, resolve to PMID first via E-search
          if (!pmid && doi) {
            const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doi)}[doi]&retmode=json&retmax=1&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
            const searchRes = await fetch(searchUrl, {
              signal: AbortSignal.timeout(10_000),
            });
            const searchData = (await searchRes.json()) as {
              esearchresult?: { idlist?: string[] };
            };
            const ids = searchData?.esearchresult?.idlist ?? [];
            if (ids.length > 0) pmid = ids[0];
          }

          if (pmid) {
            // Fetch full abstract + metadata via efetch
            const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
            const fetchRes = await fetch(fetchUrl, {
              signal: AbortSignal.timeout(10_000),
            });
            const xml = await fetchRes.text();

            // Extract title
            const titleMatch = xml.match(
              /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/
            );
            const title = titleMatch
              ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
              : "Untitled Paper";

            // Extract abstract sections
            const abstractTexts: string[] = [];
            const abstractMatches = Array.from(
              xml.matchAll(
                /<AbstractText(?:[^>]* Label="([^"]*)"|[^>]*)>([\s\S]*?)<\/AbstractText>/g
              )
            );
            for (const m of abstractMatches) {
              const label = m[1] ? `${m[1]}: ` : "";
              const text = m[2].replace(/<[^>]+>/g, "").trim();
              if (text) abstractTexts.push(label + text);
            }

            // Extract author list
            const authorMatches = Array.from(
              xml.matchAll(/<LastName>([^<]+)<\/LastName>/g)
            );
            const authors = authorMatches
              .slice(0, 6)
              .map(m => m[1])
              .join(", ");
            const authorSuffix = authorMatches.length > 6 ? " et al." : "";

            // Extract journal + year
            const journalMatch = xml.match(
              /<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/
            );
            const yearMatch = xml.match(
              /<PubDate>[\s\S]*?<Year>([0-9]{4})<\/Year>/
            );
            const citation = [
              authors ? `${authors}${authorSuffix}` : "",
              journalMatch ? journalMatch[1] : "",
              yearMatch ? `(${yearMatch[1]})` : "",
              pmid ? `PMID: ${pmid}` : "",
            ]
              .filter(Boolean)
              .join(" · ");

            // ── PMC Open Access full-text fetch ──────────────────────────
            let methodsText = "";
            try {
              // Check if this PMID has a PMC full-text record
              const pmcSearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?dbfrom=pubmed&db=pmc&id=${pmid}&retmode=json&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
              const pmcLinkRes = await fetch(pmcSearchUrl, {
                signal: AbortSignal.timeout(10_000),
              });
              const pmcLinkData = (await pmcLinkRes.json()) as {
                linksets?: Array<{
                  linksetdbs?: Array<{ dbto: string; links?: string[] }>;
                }>;
              };
              const pmcLinks =
                pmcLinkData?.linksets?.[0]?.linksetdbs?.find(
                  db => db.dbto === "pmc"
                )?.links ?? [];
              if (pmcLinks.length > 0) {
                const pmcId = pmcLinks[0];
                const ftUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${pmcId}&rettype=full&retmode=xml&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
                const ftRes = await fetch(ftUrl, {
                  signal: AbortSignal.timeout(15_000),
                });
                const ftXml = await ftRes.text();
                // Extract Methods section text
                const methodsMatch = ftXml.match(
                  /<sec[^>]*>\s*<title>[^<]*(?:method|material|experiment)[^<]*<\/title>([\s\S]*?)<\/sec>/i
                );
                if (methodsMatch) {
                  methodsText = methodsMatch[1]
                    .replace(/<[^>]+>/g, " ")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 3000);
                }
              }
            } catch {
              // PMC full-text is optional — silently continue with abstract only
            }
            const fullText = [
              `Title: ${title}`,
              citation ? `Citation: ${citation}` : "",
              "",
              abstractTexts.length > 0
                ? abstractTexts.join("\n\n")
                : "[Abstract not available — please paste the text manually]",
              methodsText ? `\nMethods (excerpt):\n${methodsText}` : "",
            ]
              .filter(l => l !== undefined && l !== "")
              .join("\n");
            return { title, text: fullText, pmid, doi: doi ?? null, citation };
          }
        } catch (err) {
          console.error("PubMed fetch error:", err);
        }

        // ── Europe PMC fallback ───────────────────────────────────────────────
        try {
          const identifier = doi ?? pmid;
          if (identifier) {
            const epmc = await fetch(
              `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(doi ? `DOI:${doi}` : `EXT_ID:${pmid}`)}&format=json&resultType=core&pageSize=1`,
              { signal: AbortSignal.timeout(10_000) }
            );
            const epmcData = (await epmc.json()) as {
              resultList?: {
                result?: Array<{
                  title?: string;
                  abstractText?: string;
                  authorString?: string;
                  journalAbbreviation?: string;
                  pubYear?: string;
                  doi?: string;
                }>;
              };
            };
            const result = epmcData?.resultList?.result?.[0];
            if (result) {
              const title = result.title ?? "Untitled Paper";
              const text = [
                `Title: ${title}`,
                result.authorString ? `Authors: ${result.authorString}` : "",
                result.journalAbbreviation
                  ? `Journal: ${result.journalAbbreviation} (${result.pubYear ?? ""})`
                  : "",
                result.doi ? `DOI: ${result.doi}` : "",
                "",
                result.abstractText ??
                  "[Abstract not available — please paste the text manually]",
              ]
                .filter(Boolean)
                .join("\n");
              return {
                title,
                text,
                pmid: pmid ?? null,
                doi: result.doi ?? doi ?? null,
                citation: `${result.authorString ?? ""} · ${result.journalAbbreviation ?? ""} (${result.pubYear ?? ""})`,
              };
            }
          }
        } catch (err) {
          console.error("Europe PMC fallback error:", err);
        }

        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Could not retrieve this paper. It may not be indexed in PubMed or Europe PMC. Please paste the text manually.",
        });
      }),

    /**
     * FrictionEngine Pre-Submission Interrogation
     * Runs the full 7-stage FrictionEngine self-prompting loop before submission.
     * Returns the complete FrictionEngineResult including:
     *   - inferred_intent, assumptions[], constraints[]
     *   - friction_question (if needed)
     *   - optimized_prompt, validation_criteria
     *   - recommended_action: execute | ask_user | reject | reframe
     *   - claim-level detail (category, assumptionExposed, falsificationTest)
     */
    preflightScan: protectedProcedure
      .input(z.object({ text: z.string().min(10).max(50_000) }))
      .mutation(async ({ input }) => {
        const { runPreflightScan } = await import("./frictionEngine");
        return runPreflightScan(input.text);
      }),
  }),

  // ─── Claims ─────────────────────────────────────────────────────────────────
  claims: router({
    byDocument: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        return getClaimsByDocument(input.documentId);
      }),

    override: protectedProcedure
      .input(
        z.object({
          claimId: z.number(),
          documentId: z.number(),
          overriddenVerdict: z.enum([
            "Supported",
            "Contradicted",
            "Partially Supported",
            "Ambiguous",
            "Insufficient Evidence",
            "Out of Scope",
            "Needs Expert Review",
          ]),
          /** Minimum 20 characters — required to preserve epistemic chain integrity */
          justification: z
            .string()
            .min(20, "Justification must be at least 20 characters"),
          /** Epistemic category explains WHY the human override is valid */
          overrideCategory: z.enum([
            "domain_expertise",
            "new_evidence",
            "context_clarification",
            "scope_adjustment",
            "error_correction",
          ]),
          /** Legacy field — kept for backward compat */
          reviewNotes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "FORBIDDEN" });
        await overrideClaimVerdict(
          input.claimId,
          ctx.user.id,
          input.overriddenVerdict,
          input.justification,
          {
            justification: input.justification,
            overrideCategory: input.overrideCategory,
            documentId: input.documentId,
          }
        );
        // Async: log override to wiki audit trail
        import("./wikiEngine")
          .then(({ appendLog }) =>
            appendLog(
              "update",
              `Claim #${input.claimId} verdict overridden (${input.overrideCategory}): ${input.justification.slice(0, 100)}`,
              1,
              `claim-${input.claimId}`,
              input.documentId
            ).catch(console.error)
          )
          .catch(console.error);
        // Calibration loop: record that the model which produced the original verdict was incorrect.
        // We look up the document's llmProvider to identify the responsible model.
        // This feeds the LLM quality scoring system and can trigger auto-bans on low-accuracy models.
        getDocumentById(input.documentId)
          .then(doc => {
            if (!doc?.llmProvider) return;
            import("./llmProviderQuality")
              .then(({ recordModelOutcome }) =>
                recordModelOutcome(doc.llmProvider, false).catch(console.error)
              )
              .catch(console.error);
          })
          .catch(console.error);
        // Publish manual_review_complete event into the Autonomous Loop
        import("./autonomousLoop/eventBus")
          .then(({ publishEvent }) =>
            publishEvent("manual_review_complete", {
              claimId: input.claimId,
              documentId: input.documentId,
              overriddenVerdict: input.overriddenVerdict,
              overrideCategory: input.overrideCategory,
              reviewerId: ctx.user.id,
            }).catch(console.error)
          )
          .catch(console.error);
        return { success: true };
      }),

    overrideLog: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        const { getOverrideAuditLog } = await import("./db");
        return getOverrideAuditLog(input.documentId);
      }),

    /** Phase 79: Determinism metrics for a document's claims */
    determinismMetrics: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        const allClaims = await getClaimsByDocument(input.documentId);
        const { computeDeterminismMetrics } = await import("./verdictEngine");
        const methods = allClaims.map(
          c => (c as Record<string, unknown>).verdictMethod
        ) as Array<import("./verdictEngine").VerdictMethod | null | undefined>;
        const metrics = computeDeterminismMetrics(methods);
        // Per-claim breakdown
        const breakdown = allClaims.map(c => ({
          id: c.id,
          claimText: c.claimText.slice(0, 120),
          verdict: c.verdict,
          verdictMethod: (c as Record<string, unknown>).verdictMethod as
            | string
            | null,
          sourceCompletenessScore: (c as Record<string, unknown>)
            .sourceCompletenessScore as number | null,
        }));
        return { metrics, breakdown };
      }),
  }),

  // ─── Reports ─────────────────────────────────────────────────────────────────
  reports: router({
    byDocument: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        return getAuditReportByDocument(input.documentId);
      }),

    regenerate: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "FORBIDDEN" });
        if (!doc.rawText)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No text available",
          });
        runAnalysisPipeline(input.documentId, doc.rawText, ctx.user.id).catch(
          console.error
        );
        return { success: true };
      }),
  }),

  // ─── Monitoring Feed ──────────────────────────────────────────────────────────
  monitoring: router({
    byDocument: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        return getMonitoringFeedByDocument(input.documentId);
      }),

    all: protectedProcedure.query(async () => {
      return getAllMonitoringFeed(50);
    }),
  }),

  // ─── Audit Requests ───────────────────────────────────────────────────────────
  auditRequests: router({
    submit: publicProcedure
      .input(
        z.object({
          tier: z.enum(["starter", "diligence", "platform_pilot"]),
          contactName: z.string().min(1).max(256),
          contactEmail: z.string().email().max(256),
          organization: z.string().max(256).optional(),
          documentDescription: z.string().min(10).max(5000),
          additionalNotes: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        // Rate limit: max 3 audit requests per email per 24 hours
        const recentRequests = await getRecentAuditRequestsByEmail(
          input.contactEmail,
          24 * 60 * 60 * 1000
        );
        if (recentRequests >= 3) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message:
              "Too many requests. Please wait 24 hours before submitting another audit request.",
          });
        }
        const id = await createAuditRequest({
          tier: input.tier,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          organization: input.organization ?? null,
          documentDescription: input.documentDescription,
          additionalNotes: input.additionalNotes ?? null,
        });
        // Notify owner
        const tierLabel =
          input.tier === "starter"
            ? "Starter ($1,500)"
            : input.tier === "diligence"
              ? "Diligence ($5,000)"
              : "Platform Pilot";
        await notifyOwner({
          title: `New Audit Request: ${tierLabel}`,
          content: `From: ${input.contactName} <${input.contactEmail}>\nOrg: ${input.organization ?? "—"}\nTier: ${tierLabel}\n\n${input.documentDescription}`,
        });
        await markAuditRequestOwnerNotified(id);
        return { success: true, requestId: id };
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllAuditRequests();
    }),
  }),

  // ─── Monitoring ingest (called by scheduled job) ──────────────────────────
  // Protected: only the document owner or an admin may ingest monitoring items.
  ingestMonitoring: protectedProcedure
    .input(
      z.object({
        documentId: z.number().int().positive(),
        items: z
          .array(
            z.object({
              source: z.enum(["pubmed", "biorxiv", "patent"]),
              title: z.string().max(512),
              summary: z.string().max(2000).optional(),
              url: z.string().url().max(2048).optional(),
              relevanceScore: z.number().min(0).max(1).optional(),
              publishedAt: z.string().max(64).optional(),
            })
          )
          .max(100), // cap batch size
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ownership check: only the document owner or admin may ingest
      const doc = await getDocumentById(input.documentId);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      if (doc.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await insertMonitoringItems(
        input.items.map(item => ({
          documentId: input.documentId,
          source: item.source,
          title: item.title,
          summary: item.summary ?? null,
          url: item.url ?? null,
          relevanceScore: item.relevanceScore ?? null,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        }))
      );
      return { success: true };
    }),

  // ─── Storage upload URL ───────────────────────────────────────────────────
  storage: router({
    uploadDocument: protectedProcedure
      .input(
        z.object({
          fileName: z.string().max(255),
          // Validate MIME type format to prevent content-type injection
          contentType: z
            .string()
            .max(128)
            .regex(/^[\w.+-]+\/[\w.+\-*]+$/),
          base64Content: z.string().max(70_000_000), // ~50 MB base64 ceiling
        })
      )
      .mutation(async ({ ctx, input }) => {
        const key = `documents/${ctx.user.id}/${Date.now()}-${input.fileName}`;
        const buffer = Buffer.from(input.base64Content, "base64");
        const { url } = await storagePut(key, buffer, input.contentType);
        return { key, url };
      }),
  }),

  // ─── Knowledge Graph ─────────────────────────────────────────────────────
  graph: router({
    data: publicProcedure.query(async () => {
      return getGraphData();
    }),

    corpusGrowthStats: publicProcedure.query(async () => {
      return getCorpusGrowthStats();
    }),

    entities: publicProcedure.query(async () => {
      const [entities, relations] = await Promise.all([
        getAllGraphEntities(500),
        getAllGraphRelations(2000),
      ]);
      // Attach relation counts to each entity
      const relCount = new Map<number, number>();
      for (const r of relations) {
        relCount.set(
          r.sourceEntityId,
          (relCount.get(r.sourceEntityId) ?? 0) + 1
        );
        relCount.set(
          r.targetEntityId,
          (relCount.get(r.targetEntityId) ?? 0) + 1
        );
      }
      return entities.map(e => ({
        ...e,
        relationCount: relCount.get(e.id) ?? 0,
      }));
    }),

    relations: publicProcedure.query(async () => {
      return getAllGraphRelations(2000);
    }),

    contradictions: publicProcedure.query(async () => {
      return getContradictionRelations(100);
    }),

    contradictionDetail: publicProcedure
      .input(z.object({ relationId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { graphRelations, graphEntities, claims, documents } =
          await import("../drizzle/schema");
        const { eq, or } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const relRows = await db
          .select()
          .from(graphRelations)
          .where(eq(graphRelations.id, input.relationId))
          .limit(1);
        if (relRows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        const rel = relRows[0];
        const entityRows = await db
          .select()
          .from(graphEntities)
          .where(
            or(
              eq(graphEntities.id, rel.sourceEntityId),
              eq(graphEntities.id, rel.targetEntityId)
            )
          );
        const sourceEntity =
          entityRows.find(e => e.id === rel.sourceEntityId) ?? null;
        const targetEntity =
          entityRows.find(e => e.id === rel.targetEntityId) ?? null;
        let evidenceDocument = null;
        if (rel.evidenceDocumentId) {
          const docRows = await db
            .select({
              id: documents.id,
              title: documents.title,
              verticalDomain: documents.verticalDomain,
              storageUrl: documents.storageUrl,
              status: documents.status,
            })
            .from(documents)
            .where(eq(documents.id, rel.evidenceDocumentId))
            .limit(1);
          evidenceDocument = docRows[0] ?? null;
        }
        const sourceClaims = sourceEntity?.firstSeenDocumentId
          ? await db
              .select({
                id: claims.id,
                claimText: claims.claimText,
                verdict: claims.verdict,
                confidenceScore: claims.confidenceScore,
                verdictRationale: claims.verdictRationale,
                documentId: claims.documentId,
              })
              .from(claims)
              .where(eq(claims.documentId, sourceEntity.firstSeenDocumentId))
              .limit(10)
          : [];
        const targetClaims = targetEntity?.firstSeenDocumentId
          ? await db
              .select({
                id: claims.id,
                claimText: claims.claimText,
                verdict: claims.verdict,
                confidenceScore: claims.confidenceScore,
                verdictRationale: claims.verdictRationale,
                documentId: claims.documentId,
              })
              .from(claims)
              .where(eq(claims.documentId, targetEntity.firstSeenDocumentId))
              .limit(10)
          : [];
        return {
          relation: rel,
          sourceEntity,
          targetEntity,
          evidenceDocument,
          sourceClaims,
          targetClaims,
        };
      }),

    resolveContradiction: protectedProcedure
      .input(
        z.object({
          relationId: z.number().int().positive(),
          resolution: z.enum([
            "source_correct",
            "target_correct",
            "both_partial",
            "needs_expert",
            "false_positive",
          ]),
          notes: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        void ctx;
        const { getDb } = await import("./db");
        const { graphRelations } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const scoreMap: Record<string, number> = {
          false_positive: 0.0,
          source_correct: 1.0,
          target_correct: 1.0,
          both_partial: 0.5,
          needs_expert: 0.1,
        };
        await db
          .update(graphRelations)
          .set({
            confidenceScore: scoreMap[input.resolution] ?? 0.5,
          })
          .where(eq(graphRelations.id, input.relationId));
        return {
          ok: true,
          resolution: input.resolution,
          resolvedAt: new Date().toISOString(),
        };
      }),

    // LLM-backed graph query: requires auth to prevent unauthenticated LLM abuse
    query: protectedProcedure
      .input(z.object({ question: z.string().min(3).max(500) }))
      .mutation(async ({ input }) => {
        // Step 1: Fetch graph context
        const [entities, relations, contradictions] = await Promise.all([
          getAllGraphEntities(200),
          getAllGraphRelations(500),
          getContradictionRelations(50),
        ]);

        const entityIndex = entities
          .map(e => `[${e.id}] ${e.entityType}: ${e.canonicalName}`)
          .join("\n");

        const relationIndex = relations
          .slice(0, 200)
          .map(r => {
            const src = entities.find(e => e.id === r.sourceEntityId);
            const tgt = entities.find(e => e.id === r.targetEntityId);
            return `${src?.canonicalName ?? r.sourceEntityId} --[${r.relationType}]--> ${tgt?.canonicalName ?? r.targetEntityId}`;
          })
          .join("\n");

        const contradictionIndex = contradictions
          .slice(0, 20)
          .map(r => {
            const src = entities.find(e => e.id === r.sourceEntityId);
            return `CONTRADICTION: ${src?.canonicalName ?? r.sourceEntityId} (confidence: ${r.confidenceScore ?? "?"})`;
          })
          .join("\n");

        // ── FrictionEngine Interaction Model ──────────────────────────────────
        // Before answering, the system exposes what assumptions the question carries.
        // "You asked X. This assumes Y. The evidence shows Z."
        // This is the FrictionEngine principle: don't just answer — surface the premise.

        const systemPrompt = `You are the Truth Desk knowledge graph assistant — a FrictionEngine applied to scientific knowledge.

Your job is NOT just to answer the question. Your job is to:
1. EXPOSE the hidden assumptions the question carries ("This assumes that...")
2. IDENTIFY what evidence would disprove the question's premise ("This would be false if...")
3. ANSWER using only what the graph evidence supports

Graph entities (${entities.length} total):
${entityIndex.slice(0, 3000)}

Graph relations (${relations.length} total):
${relationIndex.slice(0, 2000)}

${contradictionIndex ? `Known contradictions:\n${contradictionIndex}` : ""}

Respond in this exact structure:

**Assumption exposed:** [What hidden premise does this question carry?]

**Falsification test:** [What evidence would prove the premise wrong?]

**Evidence-based answer:** [Answer using only graph evidence. Cite entity IDs like [42]. If contradictions are relevant, highlight them. If evidence is insufficient, say "Insufficient Evidence" rather than guessing.]`;

        // ── Optimized prompt for the audit loop ──────────────────────────────
        const optimizedPrompt = `${systemPrompt}\n\nQuestion: ${input.question}`;
        const validationCriteria = [
          "The answer must expose the hidden assumption in the question.",
          "The answer must identify what evidence would disprove the premise.",
          "The answer must cite specific entity IDs from the graph.",
          "The answer must not guess when evidence is insufficient — say 'Insufficient Evidence'.",
        ];

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input.question },
          ],
        });

        const rawAnswer =
          response?.choices?.[0]?.message?.content ?? "No answer available.";
        let answerText =
          typeof rawAnswer === "string" ? rawAnswer : JSON.stringify(rawAnswer);

        // ── FrictionEngine Output Audit (Output Critic) ───────────────────────
        // Audit the answer against the optimized prompt. If it fails, retry once
        // with the suggested revision. This implements the paper's Answer Audit loop.
        try {
          const { runOutputAudit } = await import("./frictionEngine");
          const audit = await runOutputAudit(
            optimizedPrompt,
            answerText,
            validationCriteria
          );
          if (audit.verdict === "revise" && audit.suggestedRevision) {
            // One retry with the suggested revision injected into the prompt
            const retryResponse = await invokeLLM({
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: input.question },
                { role: "assistant", content: answerText },
                {
                  role: "user",
                  content: `The Output Critic flagged this answer. Please revise it:\n${audit.suggestedRevision}\n\nReason: ${audit.reason}`,
                },
              ],
            });
            const retryRaw = retryResponse?.choices?.[0]?.message?.content;
            if (retryRaw && typeof retryRaw === "string") {
              answerText = retryRaw;
            }
          }
        } catch (auditErr) {
          // Audit failure is non-fatal — proceed with original answer
          console.warn(
            "[FrictionEngine] Output audit error (non-fatal):",
            auditErr
          );
        }

        // Parse the structured sections for the frontend to render distinctly
        const assumptionMatch = answerText.match(
          /\*\*Assumption exposed:\*\*\s*([\s\S]*?)(?=\n\n\*\*|$)/
        );
        const falsificationMatch = answerText.match(
          /\*\*Falsification test:\*\*\s*([\s\S]*?)(?=\n\n\*\*|$)/
        );
        const evidenceMatch = answerText.match(
          /\*\*Evidence-based answer:\*\*\s*([\s\S]*)$/
        );

        return {
          answer: answerText,
          assumptionExposed: assumptionMatch?.[1]?.trim() ?? null,
          falsificationTest: falsificationMatch?.[1]?.trim() ?? null,
          evidenceAnswer: evidenceMatch?.[1]?.trim() ?? answerText,
          entityCount: entities.length,
          relationCount: relations.length,
          contradictionCount: contradictions.length,
        };
      }),
  }),

  // ─── Wiki ──────────────────────────────────────────────────────────────────
  wiki: router({
    /** Legacy S3-backed page (entity/canonical name lookup) */
    getPage: publicProcedure
      .input(z.object({ entityType: z.string(), canonicalName: z.string() }))
      .query(async ({ input }) => {
        const { wikiKey } = await import("./wikiCompiler");
        const s3Key = wikiKey(input.entityType, input.canonicalName);
        const content = await fetchWikiPage(s3Key).catch(() => "");
        return { content, s3Key };
      }),
    /** DB-backed wiki page by slug */
    getPageBySlug: publicProcedure
      .input(z.object({ slug: z.string().min(1).max(256) }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { wikiPages } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return null;
        const rows = await db
          .select()
          .from(wikiPages)
          .where(eq(wikiPages.slug, input.slug))
          .limit(1);
        return rows[0] ?? null;
      }),
    /** List DB-backed wiki pages with optional category filter and pagination */
    listPages: publicProcedure
      .input(
        z.object({
          category: z
            .enum(["entity", "concept", "synthesis", "source_summary"])
            .optional(),
          verticalDomain: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
      )
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { wikiPages } = await import("../drizzle/schema");
        const { eq, and, desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return { pages: [], total: 0 };
        const conditions = [];
        if (input.category)
          conditions.push(eq(wikiPages.category, input.category));
        if (input.verticalDomain)
          conditions.push(eq(wikiPages.verticalDomain, input.verticalDomain));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = await db
          .select({
            id: wikiPages.id,
            slug: wikiPages.slug,
            title: wikiPages.title,
            category: wikiPages.category,
            sourceCount: wikiPages.sourceCount,
            avgConfidence: wikiPages.avgConfidence,
            verticalDomain: wikiPages.verticalDomain,
            lastCompiledAt: wikiPages.lastCompiledAt,
            updatedAt: wikiPages.updatedAt,
          })
          .from(wikiPages)
          .where(where)
          .orderBy(desc(wikiPages.updatedAt))
          .limit(input.limit)
          .offset(input.offset);
        const countRows = await db
          .select({ id: wikiPages.id })
          .from(wikiPages)
          .where(where);
        return { pages: rows, total: countRows.length };
      }),
    /** Full-text search across DB wiki pages */
    search: publicProcedure
      .input(
        z.object({
          query: z.string().min(1).max(256),
          limit: z.number().int().min(1).max(50).default(10),
        })
      )
      .query(async ({ input }) => {
        const { searchWiki } = await import("./wikiEngine");
        return searchWiki(input.query, input.limit);
      }),
    /** Get the wiki index (catalog) */
    getIndex: publicProcedure.query(async () => {
      const { getDb } = await import("./db");
      const { wikiIndex } = await import("../drizzle/schema");
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(wikiIndex).limit(1);
      return rows[0] ?? null;
    }),
    /** Get recent wiki log entries */
    getLog: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { wikiLog } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(wikiLog)
          .orderBy(desc(wikiLog.recordedAt))
          .limit(input.limit);
      }),
    /** Admin: trigger a wiki lint pass and rebuild the index */
    triggerLint: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Owner or admin access required",
        });
      }
      const { lintWiki, buildIndex } = await import("./wikiEngine");
      const result = await lintWiki();
      await buildIndex();
      return result;
    }),
  }),
  // ─── Verticals ────────────────────────────────────────────────────────────
  verticals: router({
    stats: publicProcedure.query(async () => {
      return getVerticalStats();
    }),

    /**
     * Global platform-wide aggregate stats for the public home page hero.
     * Returns totalDocuments, totalClaims, supportedVerdicts, verifiedSources.
     */
    globalStats: publicProcedure.query(async () => {
      const { getGlobalPlatformStats } = await import("./db");
      return getGlobalPlatformStats();
    }),

    /**
     * List all registered research verticals with their metadata.
     * Public — used by the vertical index page.
     */
    listAll: publicProcedure.query(async () => {
      const { listVerticals } = await import("./verticalAdapters");
      return listVerticals().map(v => ({
        domainKey: v.domainKey,
        displayName: v.displayName,
        description: v.description,
        discoverySearchTerms: v.discoverySearchTerms,
      }));
    }),

    /**
     * Get detailed stats + top claims for a single vertical.
     * Public — used by individual vertical landing pages.
     */
    detail: publicProcedure
      .input(z.object({ domainKey: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        const { getVertical } = await import("./verticalAdapters");
        const adapter = getVertical(input.domainKey);
        if (!adapter) return null;

        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return null;

        const { documents, claims } = await import("../drizzle/schema");
        const { eq, desc, and, isNotNull, sql } = await import("drizzle-orm");

        // Document count and completion rate
        const docStats = await db
          .select({
            total: sql<number>`COUNT(*)`,
            completed: sql<number>`SUM(CASE WHEN ${documents.status} = 'complete' THEN 1 ELSE 0 END)`,
          })
          .from(documents)
          .where(eq(documents.verticalDomain, input.domainKey));

        const totalDocs = Number(docStats[0]?.total ?? 0);
        const completedDocs = Number(docStats[0]?.completed ?? 0);

        // Claim verdict distribution
        const verdictDist = await db
          .select({
            verdict: claims.verdict,
            count: sql<number>`COUNT(*)`,
          })
          .from(claims)
          .innerJoin(documents, eq(claims.documentId, documents.id))
          .where(
            and(
              eq(documents.verticalDomain, input.domainKey),
              isNotNull(claims.verdict)
            )
          )
          .groupBy(claims.verdict);

        const verdictCounts: Record<string, number> = {};
        let totalClaims = 0;
        for (const row of verdictDist) {
          verdictCounts[row.verdict ?? "Unknown"] = Number(row.count);
          totalClaims += Number(row.count);
        }

        // Top claims by confidence score
        const topClaims = await db
          .select({
            id: claims.id,
            claimText: claims.claimText,
            verdict: claims.verdict,
            confidenceScore: claims.confidenceScore,
            pdbEvidenceUrl: claims.pdbEvidenceUrl,
            documentId: claims.documentId,
          })
          .from(claims)
          .innerJoin(documents, eq(claims.documentId, documents.id))
          .where(
            and(
              eq(documents.verticalDomain, input.domainKey),
              isNotNull(claims.confidenceScore),
              isNotNull(claims.verdict)
            )
          )
          .orderBy(desc(claims.confidenceScore))
          .limit(10);

        // Average confidence score
        const avgScoreRow = await db
          .select({ avg: sql<number>`AVG(${claims.confidenceScore})` })
          .from(claims)
          .innerJoin(documents, eq(claims.documentId, documents.id))
          .where(
            and(
              eq(documents.verticalDomain, input.domainKey),
              isNotNull(claims.confidenceScore)
            )
          );
        const avgConfidence = avgScoreRow[0]?.avg
          ? Math.round(Number(avgScoreRow[0].avg) * 1000) / 1000
          : null;

        return {
          domainKey: adapter.domainKey,
          displayName: adapter.displayName,
          description: adapter.description,
          discoverySearchTerms: adapter.discoverySearchTerms,
          stats: {
            totalDocs,
            completedDocs,
            totalClaims,
            verdictCounts,
            avgConfidence,
          },
          topClaims,
        };
      }),

    /**
     * Admin: list all verticals from DB (verticalConfigs table).
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { verticalConfigs } = await import("../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      return db
        .select()
        .from(verticalConfigs)
        .orderBy(desc(verticalConfigs.createdAt));
    }),

    /**
     * Admin: create a new vertical in DB.
     */
    create: protectedProcedure
      .input(
        z.object({
          domainKey: z.string().min(1).max(64),
          displayName: z.string().min(1).max(128),
          description: z.string().optional(),
          qualityTier: z.enum(["draft", "verified"]).default("draft"),
          enabled: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { verticalConfigs } = await import("../drizzle/schema");
        const result = await db.insert(verticalConfigs).values({
          domainKey: input.domainKey,
          displayName: input.displayName,
          description: input.description ?? null,
          qualityTier: input.qualityTier,
          enabled: input.enabled,
        });
        return { id: Number((result as { insertId?: number }).insertId ?? 0) };
      }),

    /**
     * Admin: toggle a vertical enabled/disabled.
     */
    toggle: protectedProcedure
      .input(z.object({ id: z.number(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { verticalConfigs } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db
          .update(verticalConfigs)
          .set({ enabled: input.enabled })
          .where(eq(verticalConfigs.id, input.id));
        return { success: true };
      }),
  }),
  // ─── LLM text extraction from PDF text ────────────────────────────────────
  extractText: protectedProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input }) => {
      // Simple pass-through — text is already extracted client-side
      return { text: input.text };
    }),

  // ─── Admin ──────────────────────────────────────────────────────────────────────────
  admin: router({
    /**
     * Fire-and-forget wiki backfill.
     * Returns { status: "started" } immediately and runs in the background.
     * Progress is logged to the server console and Telegram (if configured).
     */
    backfillWiki: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Owner or admin access required",
        });
      }
      const origin =
        process.env.VITE_APP_URL ?? "https://protein-desk-5r5rzpyg.manus.space";
      const { runBackfillWiki } = await import("./backfillWikiRoute");
      // Fire-and-forget — return immediately so the HTTP connection doesn't time out
      runBackfillWiki(origin, msg => {
        console.log(`[BackfillWiki/tRPC] ${msg}`);
      }).catch(console.error);
      return {
        status: "started" as const,
        message:
          "Backfill running in background. Check server logs or Telegram for progress.",
      };
    }),

    /**
     * Returns how many completed documents have been wiki-compiled vs. pending.
     */
    backfillStatus: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { getAllCompletedDocuments } = await import("./db");
      const allCompleted = await getAllCompletedDocuments(2000);
      const compiled = allCompleted.filter(d => !!d.wikiCompiledAt).length;
      const pending = allCompleted.length - compiled;
      return {
        completedDocuments: allCompleted.length,
        wikiCompiled: compiled,
        wikiPending: pending,
        percentComplete:
          allCompleted.length > 0
            ? Math.round((compiled / allCompleted.length) * 100)
            : 0,
      };
    }),

    /**
     * Rotate the JWKS RSA key pair.
     * Generates a new RSA-2048 key pair, persists the private key via the Manus Forge
     * secrets API (JWKS_PRIVATE_KEY), appends the old kid to the wiki audit log,
     * and returns the new public JWK. Re-deploy is required to activate the new key.
     */
    rotateJwksKey: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Owner or admin access required",
        });
      }

      const crypto = await import("crypto");
      const { ACTIVE_JWK_PUBLIC_KEY, derivePublicJwk } = await import(
        "./jwksKeys"
      );
      const { appendLog } = await import("./wikiEngine");

      // Capture the old kid before rotation for audit trail
      const oldKid = ACTIVE_JWK_PUBLIC_KEY.kid as string;

      // Generate a new RSA-2048 key pair
      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      // Derive the new public JWK to return to the caller
      const newPublicJwk = derivePublicJwk(publicKey as string);

      // Persist the new private key via the Manus Forge secrets API
      const forgeApiUrl = ENV.forgeApiUrl;
      const forgeApiKey = ENV.forgeApiKey;
      const appId = process.env.VITE_APP_ID ?? "";
      let secretPersisted = false;
      if (forgeApiUrl && forgeApiKey && appId) {
        try {
          const endpoint = `${forgeApiUrl.replace(/\/$/, "")}/webdevtoken.v1.WebDevService/SetSecret`;
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${forgeApiKey}`,
              "content-type": "application/json",
              "connect-protocol-version": "1",
            },
            body: JSON.stringify({
              app_id: appId,
              key: "JWKS_PRIVATE_KEY",
              value: (privateKey as string).replace(/\n/g, "\\n"),
            }),
          });
          secretPersisted = resp.ok;
        } catch (err) {
          console.warn(
            "[RotateJwks] Could not persist new key via Forge API:",
            err
          );
        }
      }

      // Append rotation event to the wiki audit log
      await appendLog(
        "update",
        `RSA key rotated by admin ${ctx.user.name ?? ctx.user.openId}. Old kid: ${oldKid}. New kid: ${newPublicJwk.kid}. Re-deploy to activate. All bearer tokens issued with the old key remain valid until their exp claim.`,
        0,
        "jwks-key-rotation"
      );

      console.log(
        `[RotateJwks] Key rotated by ${ctx.user.openId}. Old kid: ${oldKid} \u2192 New kid: ${newPublicJwk.kid}. Secret persisted: ${secretPersisted}`
      );

      return {
        oldKid,
        newKid: newPublicJwk.kid as string,
        newPublicJwk,
        secretPersisted,
        message: secretPersisted
          ? `Key rotated. Re-deploy to activate new kid ${newPublicJwk.kid}. Old tokens remain valid until expiry.`
          : `Key generated but could not auto-persist. Copy the new kid (${newPublicJwk.kid}) and update JWKS_PRIVATE_KEY manually in Settings → Secrets.`,
      };
    }),

    /**
     * Run the meta-agent (codeGuardianAgent) on demand and return the full report.
     * Includes code health score, drift findings, stub ledger, and pipeline invariants.
     */
    metaAgentStatus: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Owner or admin access required",
        });
      }
      const { runCodeGuardian } = await import("./metaAgent/codeGuardian");
      const report = await runCodeGuardian();
      return {
        healthScore: report.healthScore,
        healthGrade: report.healthGrade,
        criticalCount: report.criticalCount,
        warningCount: report.warningCount,
        durationMs: report.durationMs,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        drift: {
          schema: {
            status: report.codeDrift.schemaDrift.severity,
            summary: report.codeDrift.schemaDrift.summary,
          },
          api: {
            status: report.codeDrift.apiDrift.severity,
            summary: report.codeDrift.apiDrift.summary,
          },
          test: {
            status: report.codeDrift.testDrift.severity,
            summary: report.codeDrift.testDrift.summary,
          },
          dependency: {
            status: report.codeDrift.dependencyDrift.severity,
            summary: report.codeDrift.dependencyDrift.summary,
          },
          config: {
            status: report.codeDrift.configDrift.severity,
            summary: report.codeDrift.configDrift.summary,
          },
          discipline: {
            status: report.codeDrift.disciplineDrift.severity,
            summary: report.codeDrift.disciplineDrift.summary,
          },
        },
        stubs: {
          total: report.stubLedger.total,
          overdue: report.stubLedger.overdue,
          byPriority: report.stubLedger.byPriority,
          overdueEscalations: report.overdueEscalations.map(e => ({
            id: e.stub.id,
            file: e.stub.file,
            line: e.stub.line,
            priority: e.stub.priority,
            daysOverdue: e.stub.daysOverdue,
            escalationReason: e.escalationReason,
            suggestedAction: e.suggestedAction,
          })),
        },
        pipeline: {
          overallStatus: report.pipelineGuardian.overallStatus,
          failCount: report.pipelineGuardian.failCount,
          warnCount: report.pipelineGuardian.warnCount,
          invariants: report.pipelineGuardian.invariants.map(inv => ({
            name: inv.name,
            status: inv.status,
            threshold: inv.threshold,
            actual: inv.actual,
            severity: inv.severity,
          })),
        },
      };
    }),

    /**
     * Full analytics dashboard data — overview, verdicts, verticals, trend, quality, top entities, activity.
     * All data fetched in parallel for fast response.
     */
    analyticsOverview: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const {
        getPlatformOverview,
        getVerdictDistribution,
        getVerticalHealth,
        getProcessingTrend,
        getQualityDistribution,
        getTopEntities,
        getRecentActivity,
      } = await import("./adminAnalytics");
      const [
        overview,
        verdicts,
        verticals,
        trend,
        quality,
        topEntities,
        activity,
      ] = await Promise.all([
        getPlatformOverview(),
        getVerdictDistribution(),
        getVerticalHealth(),
        getProcessingTrend(),
        getQualityDistribution(),
        getTopEntities(),
        getRecentActivity(),
      ]);
      return {
        overview,
        verdicts,
        verticals,
        trend,
        quality,
        topEntities,
        activity,
      };
    }),

    /**
     * Fetch all LLM provider quality stats for the admin panel.
     * Returns per-model accuracy, ban status, and usage counts.
     */
    llmProviderQuality: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { getProviderQualityStats } = await import("./llmProviderQuality");
      return getProviderQualityStats();
    }),

    /**
     * Ban a model from high-stakes verdicts.
     */
    banLlmModel: protectedProcedure
      .input(z.object({ modelId: z.string(), reason: z.string().min(10) }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { banModel } = await import("./llmProviderQuality");
        await banModel(input.modelId, input.reason);
        return { success: true };
      }),

    /**
     * Unban a model (admin action).
     */
    unbanLlmModel: protectedProcedure
      .input(z.object({ modelId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { unbanModel } = await import("./llmProviderQuality");
        await unbanModel(input.modelId);
        return { success: true };
      }),

    /**
     * Recompute accuracy rates for all models and auto-enforce bans.
     */
    recomputeLlmAccuracy: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { recomputeAllAccuracyRates } = await import(
        "./llmProviderQuality"
      );
      await recomputeAllAccuracyRates();
      return { success: true };
    }),

    /**
     * Seed known models into the quality DB (idempotent).
     */
    seedLlmModels: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { seedKnownModels } = await import("./llmProviderQuality");
      await seedKnownModels();
      return { success: true };
    }),
    /**
     * Returns the current harness health status: context snapshot age, session audit
     * result, HANDOFF.md presence, and todo.md progress.
     */
    harnessStatus: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const fs = await import("fs");
      const path = await import("path");
      const projectRoot = process.cwd();

      // Context snapshot
      const snapshotPath = path.join(projectRoot, "CONTEXT_SNAPSHOT.md");
      let snapshotExists = false;
      let snapshotAgeMinutes: number | null = null;
      let snapshotLines = 0;
      try {
        const stat = fs.statSync(snapshotPath);
        snapshotExists = true;
        snapshotAgeMinutes = Math.round((Date.now() - stat.mtimeMs) / 60000);
        const content = fs.readFileSync(snapshotPath, "utf-8");
        snapshotLines = content.split("\n").length;
      } catch {
        /* file may not exist */
      }

      // HANDOFF.md
      const handoffPath = path.join(projectRoot, "HANDOFF.md");
      let handoffExists = false;
      let handoffPreview: string | null = null;
      try {
        const handoffContent = fs.readFileSync(handoffPath, "utf-8");
        handoffExists = true;
        handoffPreview = handoffContent.split("\n").slice(0, 10).join("\n");
      } catch {
        /* file may not exist */
      }

      // Session audit JSON
      const auditJsonPath = path.join(projectRoot, ".session-audit.json");
      let lastAudit: Record<string, unknown> | null = null;
      try {
        const raw = fs.readFileSync(auditJsonPath, "utf-8");
        lastAudit = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* file may not exist */
      }

      // Todo progress
      const todoPath = path.join(projectRoot, "todo.md");
      let todoDone = 0;
      let todoPending = 0;
      try {
        const todoContent = fs.readFileSync(todoPath, "utf-8");
        todoDone = (todoContent.match(/^- \[x\]/gm) ?? []).length;
        todoPending = (todoContent.match(/^- \[ \]/gm) ?? []).length;
      } catch {
        /* file may not exist */
      }

      return {
        snapshot: {
          exists: snapshotExists,
          ageMinutes: snapshotAgeMinutes,
          lines: snapshotLines,
          healthy: snapshotExists && (snapshotAgeMinutes ?? 9999) < 120,
        },
        handoff: {
          exists: handoffExists,
          preview: handoffPreview,
        },
        lastAudit,
        todo: {
          done: todoDone,
          pending: todoPending,
          percentComplete:
            todoDone + todoPending > 0
              ? Math.round((todoDone / (todoDone + todoPending)) * 100)
              : 100,
        },
        checkedAt: new Date().toISOString(),
      };
    }),
    /**
     * Triggers `node scripts/context-snapshot.mjs` and returns success/failure.
     */
    /**
     * Read feature_list.json — the machine-readable contract derived from todo.md.
     * Run `pnpm feature:sync` to regenerate from the latest todo.md.
     */
    featureList: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { readFileSync, existsSync } = await import("fs");
      const { resolve } = await import("path");
      const path = resolve(process.cwd(), "feature_list.json");
      if (!existsSync(path)) {
        return {
          meta: {
            source: "todo.md",
            total: 0,
            done: 0,
            pending: 0,
            percent_complete: 0,
          },
          features: [] as Array<{
            id: string;
            category: string;
            phase: string;
            description: string;
            passes: boolean;
            notes: string;
          }>,
        };
      }
      return JSON.parse(readFileSync(path, "utf8")) as {
        meta: {
          source: string;
          total: number;
          done: number;
          pending: number;
          percent_complete: number;
        };
        features: Array<{
          id: string;
          category: string;
          phase: string;
          description: string;
          passes: boolean;
          notes: string;
        }>;
      };
    }),

    /**
     * Update the `notes` field for a single feature in feature_list.json.
     * Useful for annotating blockers, decisions, or context during a session.
     */
    updateFeatureNote: protectedProcedure
      .input(z.object({ id: z.string(), notes: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { readFileSync, writeFileSync, existsSync } = await import("fs");
        const { resolve } = await import("path");
        const path = resolve(process.cwd(), "feature_list.json");
        if (!existsSync(path))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "feature_list.json not found",
          });
        const data = JSON.parse(readFileSync(path, "utf8")) as {
          meta: object;
          features: Array<{ id: string; notes: string; [k: string]: unknown }>;
        };
        const feature = data.features.find(f => f.id === input.id);
        if (!feature)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Feature ${input.id} not found`,
          });
        feature.notes = input.notes;
        writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
        return { success: true };
      }),

    refreshSnapshot: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { execSync } = await import("child_process");
      try {
        execSync("node scripts/context-snapshot.mjs", {
          cwd: process.cwd(),
          timeout: 30000,
          stdio: "pipe",
        });
        return { success: true, message: "Context snapshot refreshed." };
      } catch (err) {
        return {
          success: false,
          message: `Snapshot failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    }),
  }),

  // ─── Predictions (Ground Signal) ─────────────────────────────────────────────
  predictions: router({
    forClaim: protectedProcedure
      .input(z.object({ claimId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getPredictionsByClaimId } = await import("./db");
        const { computeClaimTrajectory } = await import("./predictionEngine");
        const stored = await getPredictionsByClaimId(input.claimId);
        if (stored.length > 0) {
          return stored[0].prediction as Awaited<
            ReturnType<typeof computeClaimTrajectory>
          >;
        }
        return computeClaimTrajectory(input.claimId, ctx.user.id);
      }),

    authorReliability: protectedProcedure.query(async ({ ctx }) => {
      const { computeAuthorReliability } = await import("./predictionEngine");
      return computeAuthorReliability(ctx.user.id);
    }),

    // ─── Calibration (admin-only) ─────────────────────────────────────────────
    calibrationStats: protectedProcedure
      .input(z.object({ modelType: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { getCalibrationStats } = await import("./db");
        return getCalibrationStats(input.modelType);
      }),

    predictionsForReview: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
      .query(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { getPredictionsForReview } = await import("./db");
        return getPredictionsForReview(input.limit);
      }),

    validatePrediction: protectedProcedure
      .input(
        z.object({
          predictionId: z.number(),
          result: z.enum(["correct", "incorrect"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { updatePredictionModelValidation } = await import("./db");
        await updatePredictionModelValidation(input.predictionId, input.result);
        return { success: true };
      }),
  }),

  // ─── Webhook Alerts ────────────────────────────────────────────────────────
  alerts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getWebhookAlertsByUser } = await import("./db");
      return getWebhookAlertsByUser(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          url: z.string().url("Must be a valid URL"),
          label: z.string().max(128).optional(),
          eventTypes: z.array(z.string()).default(["high_risk_claim"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const crypto = await import("crypto");
        const secret = crypto.randomBytes(32).toString("hex");
        const { insertWebhookAlert } = await import("./db");
        await insertWebhookAlert({
          userId: ctx.user.id,
          url: input.url,
          secret,
          label: input.label,
          eventTypes: input.eventTypes,
        });
        return { success: true, secret };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { deleteWebhookAlert } = await import("./db");
        await deleteWebhookAlert(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // ─── Webhook Delivery Log ──────────────────────────────────────────────────
  deliveryLog: router({
    list: protectedProcedure
      .input(
        z.object({
          webhookId: z.number().optional(),
          status: z
            .enum(["success", "failed", "timeout", "retry_pending"])
            .optional(),
          eventType: z.string().optional(),
          limit: z.number().min(1).max(200).default(50),
          offset: z.number().min(0).default(0),
        })
      )
      .query(async ({ input }) => {
        const { getDeliveryLog } = await import("./webhookDeliveryService");
        return getDeliveryLog(input);
      }),
    stats: protectedProcedure
      .input(z.object({ webhookId: z.number().optional() }))
      .query(async ({ input }) => {
        const { getDeliveryStats } = await import("./webhookDeliveryService");
        return getDeliveryStats(input.webhookId);
      }),
    retry: protectedProcedure
      .input(z.object({ deliveryLogId: z.number() }))
      .mutation(async ({ input }) => {
        const { manualRetry } = await import("./webhookDeliveryService");
        return manualRetry(input.deliveryLogId);
      }),
    prune: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { pruneDeliveryLog } = await import("./webhookDeliveryService");
      const pruned = await pruneDeliveryLog();
      return { pruned };
    }),
  }),

  // ─── Coordinator (admin-only) ─────────────────────────────────────────────
  coordinator: router({
    /**
     * Dashboard summary: active tasks, queue depth per vertical, recent errors.
     */
    summary: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return { tasks: [], queueStats: {}, recentErrors: [] };
      const { coordTasks, coordQueue } = await import("../drizzle/schema");
      const { eq, or, and, gt, desc, sql } = await import("drizzle-orm");
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const tasks = await db
        .select()
        .from(coordTasks)
        .where(
          or(
            eq(coordTasks.status, "running"),
            eq(coordTasks.status, "pending"),
            eq(coordTasks.status, "stalled"),
            and(
              eq(coordTasks.status, "failed"),
              gt(coordTasks.startedAt, oneHourAgo)
            )
          )
        )
        .orderBy(desc(coordTasks.startedAt))
        .limit(100);

      const queueRows = await db
        .select({
          vertical: coordQueue.vertical,
          status: coordQueue.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(coordQueue)
        .groupBy(coordQueue.vertical, coordQueue.status);

      const queueStats: Record<string, Record<string, number>> = {};
      for (const row of queueRows) {
        if (!queueStats[row.vertical]) {
          queueStats[row.vertical] = {
            pending: 0,
            claimed: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            total: 0,
          };
        }
        queueStats[row.vertical][row.status] = Number(row.count);
        queueStats[row.vertical].total += Number(row.count);
      }

      const recentErrors = await db
        .select()
        .from(coordTasks)
        .where(
          and(
            eq(coordTasks.status, "failed"),
            gt(coordTasks.startedAt, oneHourAgo)
          )
        )
        .orderBy(desc(coordTasks.completedAt))
        .limit(20);

      return { tasks, queueStats, recentErrors };
    }),

    /**
     * List all coord_context keys for a namespace.
     */
    contextList: protectedProcedure
      .input(z.object({ namespace: z.string().default("global") }))
      .query(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return [];
        const { coordContext } = await import("../drizzle/schema");
        const { eq, and, or, isNull, gt, desc } = await import("drizzle-orm");
        return db
          .select()
          .from(coordContext)
          .where(
            and(
              eq(coordContext.namespace, input.namespace),
              or(
                isNull(coordContext.expiresAt),
                gt(coordContext.expiresAt, new Date())
              )
            )
          )
          .orderBy(desc(coordContext.updatedAt))
          .limit(200);
      }),

    /**
     * Mark a stalled task as failed (admin manual override).
     */
    forceFailTask: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { coordTasks } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db
          .update(coordTasks)
          .set({
            status: "failed",
            errorMsg: "Manually failed by admin",
            completedAt: new Date(),
          })
          .where(eq(coordTasks.taskId, input.taskId));
        return { ok: true };
      }),

    /**
     * Delete a task from the registry.
     */
    deleteTask: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { coordTasks } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.delete(coordTasks).where(eq(coordTasks.taskId, input.taskId));
        return { ok: true };
      }),

    /**
     * Trigger the quality scoring pipeline manually (admin only).
     * Scores up to 500 unscored/stale claims and returns a summary.
     */
    triggerQualityScorer: protectedProcedure.mutation(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { runQualityScorerJob } = await import("./claimQualityScorer");
      const result = await runQualityScorerJob();
      return { ok: true, ...result };
    }),

    /**
     * Score all claims for a specific document (admin only).
     */
    scoreDocument: protectedProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { scoreBatch } = await import("./claimQualityScorer");
        const scores = await scoreBatch(input.documentId);
        const avgScore =
          scores.length > 0
            ? Math.round(
                (scores.reduce((s, c) => s + c.compositeScore, 0) /
                  scores.length) *
                  1000
              ) / 1000
            : 0;
        return { ok: true, scored: scores.length, avgScore, scores };
      }),
  }),

  /**
   * Claim similarity engine — TF-IDF cosine similarity across the corpus.
   */
  similarity: router({
    findSimilar: publicProcedure
      .input(
        z.object({
          queryText: z.string().min(5).max(2000),
          threshold: z.number().min(0).max(1).optional().default(0.35),
          topK: z.number().int().min(1).max(50).optional().default(10),
        })
      )
      .query(async ({ input }) => {
        const { findSimilarClaims } = await import("./claimSimilarityEngine");
        return findSimilarClaims(input.queryText, {
          threshold: input.threshold,
          topK: input.topK,
        });
      }),
    findSimilarToId: publicProcedure
      .input(
        z.object({
          claimId: z.number().int().positive(),
          threshold: z.number().min(0).max(1).optional().default(0.35),
          topK: z.number().int().min(1).max(20).optional().default(8),
        })
      )
      .query(async ({ input }) => {
        const { findSimilarToClaimId } = await import(
          "./claimSimilarityEngine"
        );
        return findSimilarToClaimId(input.claimId, {
          threshold: input.threshold,
          topK: input.topK,
        });
      }),
    detectDuplicates: protectedProcedure
      .input(
        z.object({
          documentId: z.number().int().positive(),
          threshold: z.number().min(0).max(1).optional().default(0.8),
        })
      )
      .query(async ({ ctx, input }) => {
        const { getDocumentById } = await import("./db");
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        const { detectDuplicatesInDocument } = await import(
          "./claimSimilarityEngine"
        );
        return detectDuplicatesInDocument(input.documentId, input.threshold);
      }),
  }),
  /**
   * Unified search across claims and entities.
   */
  search: router({
    /**
     * Search claims by keyword with relevance ranking.
     */
    claims: publicProcedure
      .input(
        z.object({
          query: z.string().min(2).max(256),
          limit: z.number().int().min(1).max(50).default(20),
          verticalDomain: z.string().optional(),
          verdict: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        const { searchClaims } = await import("./searchEngine");
        const results = await searchClaims(input.query, {
          limit: input.limit,
          verticalDomain: input.verticalDomain,
          verdict: input.verdict,
        });
        return { results, count: results.length };
      }),

    /**
     * Search entities in the knowledge graph.
     */
    entities: publicProcedure
      .input(
        z.object({
          query: z.string().min(2).max(256),
          limit: z.number().int().min(1).max(20).default(10),
        })
      )
      .query(async ({ input }) => {
        const { searchEntities } = await import("./searchEngine");
        const results = await searchEntities(input.query, {
          limit: input.limit,
        });
        return { results, count: results.length };
      }),

    /**
     * Unified search across claims and entities in a single call.
     */
    unified: publicProcedure
      .input(
        z.object({
          query: z.string().min(2).max(256),
          claimLimit: z.number().int().min(1).max(50).default(20),
          entityLimit: z.number().int().min(1).max(10).default(5),
          verticalDomain: z.string().optional(),
          verdict: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        const { unifiedSearch } = await import("./searchEngine");
        return unifiedSearch(input.query, {
          claimLimit: input.claimLimit,
          entityLimit: input.entityLimit,
          verticalDomain: input.verticalDomain,
          verdict: input.verdict,
        });
      }),

    /**
     * TurboVec semantic similarity search.
     * Uses FAISS + sentence-transformers when the Python sidecar is running;
     * gracefully falls back to MySQL FULLTEXT search otherwise.
     */
    similar: publicProcedure
      .input(
        z.object({
          query: z.string().min(1).max(512),
          topK: z.number().int().min(1).max(50).optional().default(10),
          vertical: z.string().optional(),
          verdict: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        const { searchClaims } = await import("./vectorStore");
        const hits = await searchClaims({
          query: input.query,
          topK: input.topK,
          vertical: input.vertical,
          verdict: input.verdict,
        });
        return { hits, query: input.query };
      }),

    /**
     * TurboVec sidecar health — tells the frontend whether vector search is
     * active or falling back to SQL full-text.
     */
    vectorHealth: publicProcedure.query(async () => {
      try {
        const res = await fetch("http://127.0.0.1:5001/health", {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) {
          const data = (await res.json()) as { indexed: number; dim: number };
          return { available: true, indexed: data.indexed, dim: data.dim };
        }
      } catch {
        // sidecar not running
      }
      return { available: false, indexed: 0, dim: 0 };
    }),
  }),

  // ─── Vertical Alert Subscriptions ──────────────────────────────────────────
  verticalAlerts: router({
    /**
     * List all vertical alert subscriptions for the current user.
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { verticalAlerts } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      return db
        .select()
        .from(verticalAlerts)
        .where(eq(verticalAlerts.userId, ctx.user.id));
    }),

    /**
     * Subscribe to a vertical or update an existing subscription.
     */
    upsert: protectedProcedure
      .input(
        z.object({
          verticalDomain: z.string().min(1).max(128),
          minConfidence: z.number().min(0).max(1).default(0.7),
          notifyContradictions: z.boolean().default(true),
          notifySupported: z.boolean().default(true),
          frequency: z.enum(["instant", "daily", "weekly"]).default("daily"),
          active: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { verticalAlerts } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const existing = await db
          .select({ id: verticalAlerts.id })
          .from(verticalAlerts)
          .where(
            and(
              eq(verticalAlerts.userId, ctx.user.id),
              eq(verticalAlerts.verticalDomain, input.verticalDomain)
            )
          )
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(verticalAlerts)
            .set({
              minConfidence: input.minConfidence,
              notifyContradictions: input.notifyContradictions,
              notifySupported: input.notifySupported,
              frequency: input.frequency,
              active: input.active,
            })
            .where(eq(verticalAlerts.id, existing[0].id));
          return { ok: true, action: "updated" as const };
        }
        await db.insert(verticalAlerts).values({
          userId: ctx.user.id,
          verticalDomain: input.verticalDomain,
          minConfidence: input.minConfidence,
          notifyContradictions: input.notifyContradictions,
          notifySupported: input.notifySupported,
          frequency: input.frequency,
          active: input.active,
        });
        return { ok: true, action: "created" as const };
      }),

    /**
     * Delete a vertical alert subscription.
     */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { verticalAlerts } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        await db
          .delete(verticalAlerts)
          .where(
            and(
              eq(verticalAlerts.id, input.id),
              eq(verticalAlerts.userId, ctx.user.id)
            )
          );
        return { ok: true };
      }),

    /**
     * Admin: trigger a digest sweep for a given frequency.
     */
    triggerDigest: protectedProcedure
      .input(
        z.object({
          frequency: z.enum(["instant", "daily", "weekly"]).default("daily"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { runDigestSweep } = await import(
          "./verticalNotificationService"
        );
        return runDigestSweep(input.frequency);
      }),

    /**
     * Get notification history for the current user.
     */
    history: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
      .query(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return [];
        const { notificationLog } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        return db
          .select()
          .from(notificationLog)
          .where(eq(notificationLog.userId, ctx.user.id))
          .orderBy(desc(notificationLog.sentAt))
          .limit(input.limit);
      }),
  }),

  // ─── Evidence Timeline ────────────────────────────────────────────────────────
  timeline: router({
    /**
     * Get the evidence timeline for a specific claim text.
     * Returns all claims matching the text across all documents,
     * ordered by publication year, showing how evidence has evolved over time.
     */
    forClaim: publicProcedure
      .input(
        z.object({
          claimText: z.string().min(3).max(512),
          limit: z.number().int().min(1).max(100).default(50),
        })
      )
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return { events: [], summary: null };
        const { claims, documents, autoIngestedPapers } = await import(
          "../drizzle/schema"
        );
        const { eq, asc, sql } = await import("drizzle-orm");

        const matchingClaims = await db
          .select({
            claimId: claims.id,
            claimText: claims.claimText,
            verdict: claims.verdict,
            confidenceScore: claims.confidenceScore,
            confidenceFlags: claims.confidenceFlags,
            verdictRationale: claims.verdictRationale,
            claimCreatedAt: claims.createdAt,
            documentId: documents.id,
            documentTitle: documents.title,
            verticalDomain: documents.verticalDomain,
            storageUrl: documents.storageUrl,
            pmid: autoIngestedPapers.pmid,
            pubYear: autoIngestedPapers.pubYear,
            journal: autoIngestedPapers.journal,
            authors: autoIngestedPapers.authors,
          })
          .from(claims)
          .innerJoin(documents, eq(claims.documentId, documents.id))
          .leftJoin(
            autoIngestedPapers,
            eq(autoIngestedPapers.documentId, documents.id)
          )
          .where(
            sql`LOWER(${claims.claimText}) LIKE LOWER(${`%${escapeLike(input.claimText.slice(0, 80))}%`})`
          )
          .orderBy(
            sql`COALESCE(${autoIngestedPapers.pubYear}, YEAR(${documents.createdAt})) ASC`,
            asc(documents.createdAt)
          )
          .limit(input.limit);

        if (matchingClaims.length === 0) return { events: [], summary: null };

        const events = matchingClaims.map(row => ({
          claimId: row.claimId,
          claimText: row.claimText,
          verdict: row.verdict,
          confidenceScore: row.confidenceScore,
          confidenceFlags: row.confidenceFlags as string[] | null,
          verdictRationale: row.verdictRationale,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          verticalDomain: row.verticalDomain,
          storageUrl: row.storageUrl,
          pmid: row.pmid,
          pubYear: row.pubYear,
          journal: row.journal,
          authors: row.authors,
          date: row.pubYear
            ? `${row.pubYear}-01-01`
            : row.claimCreatedAt.toISOString().slice(0, 10),
        }));

        const verdictCounts: Record<string, number> = {};
        let totalConfidence = 0;
        let scoredCount = 0;
        for (const ev of events) {
          if (ev.verdict)
            verdictCounts[ev.verdict] = (verdictCounts[ev.verdict] ?? 0) + 1;
          if (ev.confidenceScore != null) {
            totalConfidence += ev.confidenceScore;
            scoredCount++;
          }
        }

        const midpoint = Math.floor(events.length / 2);
        const firstHalf = events
          .slice(0, midpoint)
          .filter(e => e.confidenceScore != null);
        const secondHalf = events
          .slice(midpoint)
          .filter(e => e.confidenceScore != null);
        const firstAvg = firstHalf.length
          ? firstHalf.reduce((s, e) => s + (e.confidenceScore ?? 0), 0) /
            firstHalf.length
          : null;
        const secondAvg = secondHalf.length
          ? secondHalf.reduce((s, e) => s + (e.confidenceScore ?? 0), 0) /
            secondHalf.length
          : null;
        const trend:
          | "improving"
          | "declining"
          | "stable"
          | "insufficient_data" =
          firstAvg == null || secondAvg == null
            ? "insufficient_data"
            : secondAvg - firstAvg > 0.05
              ? "improving"
              : firstAvg - secondAvg > 0.05
                ? "declining"
                : "stable";

        return {
          events,
          summary: {
            totalEvents: events.length,
            verdictDistribution: verdictCounts,
            averageConfidence:
              scoredCount > 0 ? totalConfidence / scoredCount : null,
            confidenceTrend: trend,
            earliestYear: events[0]?.pubYear ?? null,
            latestYear: events[events.length - 1]?.pubYear ?? null,
          },
        };
      }),

    /**
     * Get the evidence timeline for a specific entity by slug.
     */
    forEntity: publicProcedure
      .input(
        z.object({
          entitySlug: z.string().min(1).max(256),
          limit: z.number().int().min(1).max(100).default(50),
        })
      )
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return { events: [], entity: null, summary: null };
        const { claims, documents, autoIngestedPapers, graphEntities } =
          await import("../drizzle/schema");
        const { eq, asc, sql } = await import("drizzle-orm");

        // entitySlug is treated as canonicalName (URL-encoded form)
        const entityName = decodeURIComponent(input.entitySlug).replace(
          /-/g,
          " "
        );
        const entityRows = await db
          .select()
          .from(graphEntities)
          .where(
            sql`LOWER(${graphEntities.canonicalName}) = LOWER(${entityName})`
          )
          .limit(1);
        const entity = entityRows[0] ?? null;
        if (!entity) return { events: [], entity: null, summary: null };

        const matchingClaims = await db
          .select({
            claimId: claims.id,
            claimText: claims.claimText,
            verdict: claims.verdict,
            confidenceScore: claims.confidenceScore,
            verdictRationale: claims.verdictRationale,
            claimCreatedAt: claims.createdAt,
            documentId: documents.id,
            documentTitle: documents.title,
            verticalDomain: documents.verticalDomain,
            storageUrl: documents.storageUrl,
            pmid: autoIngestedPapers.pmid,
            pubYear: autoIngestedPapers.pubYear,
            journal: autoIngestedPapers.journal,
            authors: autoIngestedPapers.authors,
          })
          .from(claims)
          .innerJoin(documents, eq(claims.documentId, documents.id))
          .leftJoin(
            autoIngestedPapers,
            eq(autoIngestedPapers.documentId, documents.id)
          )
          .where(
            sql`LOWER(${claims.claimText}) LIKE LOWER(${`%${escapeLike(entity.canonicalName.slice(0, 80))}%`})`
          )
          .orderBy(
            sql`COALESCE(${autoIngestedPapers.pubYear}, YEAR(${documents.createdAt})) ASC`,
            asc(documents.createdAt)
          )
          .limit(input.limit);

        const events = matchingClaims.map(row => ({
          claimId: row.claimId,
          claimText: row.claimText,
          verdict: row.verdict,
          confidenceScore: row.confidenceScore,
          verdictRationale: row.verdictRationale,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          verticalDomain: row.verticalDomain,
          storageUrl: row.storageUrl,
          pmid: row.pmid,
          pubYear: row.pubYear,
          journal: row.journal,
          authors: row.authors,
          date: row.pubYear
            ? `${row.pubYear}-01-01`
            : row.claimCreatedAt.toISOString().slice(0, 10),
        }));

        const verdictCounts: Record<string, number> = {};
        for (const ev of events) {
          if (ev.verdict)
            verdictCounts[ev.verdict] = (verdictCounts[ev.verdict] ?? 0) + 1;
        }

        return {
          events,
          entity: {
            id: entity.id,
            canonicalName: entity.canonicalName,
            entityType: entity.entityType,
          },
          summary: {
            totalEvents: events.length,
            verdictDistribution: verdictCounts,
          },
        };
      }),
  }),

  // ─── Audit Comparison ────────────────────────────────────────────────────────
  auditComparison: router({
    /**
     * Compare two documents side-by-side: matched claims, verdict diffs, and
     * a summary of what changed between the two audit reports.
     */
    compare: protectedProcedure
      .input(
        z.object({
          documentIdA: z.number(),
          documentIdB: z.number(),
        })
      )
      .query(async ({ ctx, input }) => {
        const [docA, docB] = await Promise.all([
          getDocumentById(input.documentIdA),
          getDocumentById(input.documentIdB),
        ]);
        if (!docA || docA.userId !== ctx.user.id)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Document A not found",
          });
        if (!docB || docB.userId !== ctx.user.id)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Document B not found",
          });

        const [claimsA, claimsB, reportA, reportB] = await Promise.all([
          getClaimsByDocument(input.documentIdA),
          getClaimsByDocument(input.documentIdB),
          getAuditReportByDocument(input.documentIdA),
          getAuditReportByDocument(input.documentIdB),
        ]);

        type ClaimRow = Awaited<ReturnType<typeof getClaimsByDocument>>[number];
        const normalise = (s: string) =>
          s
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, "")
            .replace(/\s+/g, " ")
            .trim();

        const matchedPairs: Array<{
          claimA: ClaimRow | null;
          claimB: ClaimRow | null;
          similarity: "exact" | "similar" | "unique";
          verdictChanged: boolean;
          confidenceChanged: boolean;
        }> = [];
        const usedB = new Set<number>();

        for (const cA of claimsA) {
          const normA = normalise(cA.claimText);
          let bestMatch: ClaimRow | null = null;
          let bestScore = 0;
          for (const cB of claimsB) {
            if (usedB.has(cB.id)) continue;
            const normB = normalise(cB.claimText);
            const wordsA = new Set(normA.split(" "));
            const wordsB = new Set(normB.split(" "));
            const intersection = Array.from(wordsA).filter(w =>
              wordsB.has(w)
            ).length;
            const union = new Set([
              ...Array.from(wordsA),
              ...Array.from(wordsB),
            ]).size;
            const score = union > 0 ? intersection / union : 0;
            if (score > bestScore) {
              bestScore = score;
              bestMatch = cB;
            }
          }
          if (bestMatch && bestScore >= 0.5) {
            usedB.add(bestMatch.id);
            matchedPairs.push({
              claimA: cA,
              claimB: bestMatch,
              similarity: bestScore >= 0.9 ? "exact" : "similar",
              verdictChanged: cA.verdict !== bestMatch.verdict,
              confidenceChanged:
                Math.abs(
                  (cA.confidenceScore ?? 0) - (bestMatch.confidenceScore ?? 0)
                ) > 0.05,
            });
          } else {
            matchedPairs.push({
              claimA: cA,
              claimB: null,
              similarity: "unique",
              verdictChanged: false,
              confidenceChanged: false,
            });
          }
        }
        for (const cB of claimsB) {
          if (!usedB.has(cB.id)) {
            matchedPairs.push({
              claimA: null,
              claimB: cB,
              similarity: "unique",
              verdictChanged: false,
              confidenceChanged: false,
            });
          }
        }

        const verdictChanges = matchedPairs.filter(
          p => p.verdictChanged
        ).length;
        const onlyInA = matchedPairs.filter(p => !p.claimB).length;
        const onlyInB = matchedPairs.filter(p => !p.claimA).length;
        const avgConfA =
          claimsA.length > 0
            ? claimsA.reduce((s, c) => s + (c.confidenceScore ?? 0), 0) /
              claimsA.length
            : 0;
        const avgConfB =
          claimsB.length > 0
            ? claimsB.reduce((s, c) => s + (c.confidenceScore ?? 0), 0) /
              claimsB.length
            : 0;

        return {
          documentA: {
            id: docA.id,
            title: docA.title,
            status: docA.status,
            createdAt: docA.createdAt,
          },
          documentB: {
            id: docB.id,
            title: docB.title,
            status: docB.status,
            createdAt: docB.createdAt,
          },
          reportA: reportA ?? null,
          reportB: reportB ?? null,
          pairs: matchedPairs,
          summary: {
            claimsInA: claimsA.length,
            claimsInB: claimsB.length,
            matchedPairs: matchedPairs.filter(p => p.claimA && p.claimB).length,
            verdictChanges,
            onlyInA,
            onlyInB,
            avgConfidenceA: Math.round(avgConfA * 1000) / 1000,
            avgConfidenceB: Math.round(avgConfB * 1000) / 1000,
            confidenceDelta: Math.round((avgConfB - avgConfA) * 1000) / 1000,
          },
        };
      }),

    listForPicker: protectedProcedure.query(async ({ ctx }) => {
      const docs = await getDocumentsByUser(ctx.user.id);
      return docs.map(d => ({
        id: d.id,
        title: d.title,
        status: d.status,
        createdAt: d.createdAt,
      }));
    }),
  }),

  // ─── Vertical Leaderboard ─────────────────────────────────────────────────
  leaderboard: router({
    topEntities: publicProcedure
      .input(
        z.object({
          vertical: z.string().optional(),
          entityType: z
            .enum([
              "protein",
              "pdb_id",
              "method",
              "organism",
              "ligand",
              "author",
              "concept",
              "document",
            ])
            .optional(),
          limit: z.number().min(1).max(50).default(20),
        })
      )
      .query(async ({ input }) => {
        const { getDb: getDb2 } = await import("./db");
        const db = await getDb2();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const { sql, eq } = await import("drizzle-orm");
        const { graphEntities, graphRelations, documents } = await import(
          "../drizzle/schema"
        );

        const now = new Date();
        const thirtyDaysAgo = new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000
        );
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        const entityTypeFilter = input.entityType
          ? eq(graphEntities.entityType, input.entityType)
          : undefined;

        const entitiesWithCounts = await db
          .select({
            id: graphEntities.id,
            canonicalName: graphEntities.canonicalName,
            entityType: graphEntities.entityType,
            totalCitations: sql<number>`(
              SELECT COUNT(*) FROM graph_relations gr
              WHERE gr.sourceEntityId = ${graphEntities.id}
                 OR gr.targetEntityId = ${graphEntities.id}
            )`.as("totalCitations"),
            recentCitations: sql<number>`(
              SELECT COUNT(*) FROM graph_relations gr
              WHERE (gr.sourceEntityId = ${graphEntities.id} OR gr.targetEntityId = ${graphEntities.id})
                AND gr.createdAt >= ${thirtyDaysAgo}
            )`.as("recentCitations"),
            prevCitations: sql<number>`(
              SELECT COUNT(*) FROM graph_relations gr
              WHERE (gr.sourceEntityId = ${graphEntities.id} OR gr.targetEntityId = ${graphEntities.id})
                AND gr.createdAt >= ${sixtyDaysAgo}
                AND gr.createdAt < ${thirtyDaysAgo}
            )`.as("prevCitations"),
          })
          .from(graphEntities)
          .where(entityTypeFilter)
          .orderBy(sql`totalCitations DESC`)
          .limit(input.limit * 3);

        let filtered = entitiesWithCounts;
        if (input.vertical) {
          const verticalEntityIds = await db
            .selectDistinct({ entityId: graphRelations.sourceEntityId })
            .from(graphRelations)
            .innerJoin(
              documents,
              eq(graphRelations.evidenceDocumentId, documents.id)
            )
            .where(eq(documents.verticalDomain, input.vertical))
            .limit(5000);
          const verticalEntityIdSet = new Set(
            verticalEntityIds.map((r: { entityId: number }) => r.entityId)
          );

          const targetEntityIds = await db
            .selectDistinct({ entityId: graphRelations.targetEntityId })
            .from(graphRelations)
            .innerJoin(
              documents,
              eq(graphRelations.evidenceDocumentId, documents.id)
            )
            .where(eq(documents.verticalDomain, input.vertical))
            .limit(5000);
          targetEntityIds.forEach((r: { entityId: number }) =>
            verticalEntityIdSet.add(r.entityId)
          );

          filtered = entitiesWithCounts.filter((e: { id: number }) =>
            verticalEntityIdSet.has(e.id)
          );
        }

        const top = filtered.slice(0, input.limit);

        return top.map(
          (
            e: {
              id: number;
              canonicalName: string;
              entityType: string;
              totalCitations: number;
              recentCitations: number;
              prevCitations: number;
            },
            rank: number
          ) => ({
            rank: rank + 1,
            id: e.id,
            canonicalName: e.canonicalName,
            entityType: e.entityType,
            totalCitations: Number(e.totalCitations),
            recentCitations: Number(e.recentCitations),
            prevCitations: Number(e.prevCitations),
            trend:
              Number(e.recentCitations) > Number(e.prevCitations)
                ? ("up" as const)
                : Number(e.recentCitations) < Number(e.prevCitations)
                  ? ("down" as const)
                  : ("stable" as const),
            trendDelta: Number(e.recentCitations) - Number(e.prevCitations),
          })
        );
      }),

    verticalSummary: publicProcedure.query(async () => {
      const { getDb: getDb3 } = await import("./db");
      const db = await getDb3();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });

      const { sql, eq } = await import("drizzle-orm");
      const { graphRelations, documents } = await import("../drizzle/schema");

      const verticals = await db
        .selectDistinct({ vertical: documents.verticalDomain })
        .from(documents)
        .where(sql`${documents.verticalDomain} IS NOT NULL`);

      const summaries = await Promise.all(
        verticals.map(async ({ vertical }: { vertical: string }) => {
          const entityIds = await db
            .selectDistinct({ entityId: graphRelations.sourceEntityId })
            .from(graphRelations)
            .innerJoin(
              documents,
              eq(graphRelations.evidenceDocumentId, documents.id)
            )
            .where(eq(documents.verticalDomain, vertical))
            .limit(10000);

          const targetIds = await db
            .selectDistinct({ entityId: graphRelations.targetEntityId })
            .from(graphRelations)
            .innerJoin(
              documents,
              eq(graphRelations.evidenceDocumentId, documents.id)
            )
            .where(eq(documents.verticalDomain, vertical))
            .limit(10000);

          const allIds = new Set([
            ...entityIds.map((r: { entityId: number }) => r.entityId),
            ...targetIds.map((r: { entityId: number }) => r.entityId),
          ]);

          const citationCount = await db
            .select({ cnt: sql<number>`COUNT(*)` })
            .from(graphRelations)
            .innerJoin(
              documents,
              eq(graphRelations.evidenceDocumentId, documents.id)
            )
            .where(eq(documents.verticalDomain, vertical));

          return {
            vertical,
            entityCount: allIds.size,
            citationCount: Number(citationCount[0]?.cnt ?? 0),
          };
        })
      );

      return summaries.sort(
        (a: { citationCount: number }, b: { citationCount: number }) =>
          b.citationCount - a.citationCount
      );
    }),
  }),

  // ─── Provenance ──────────────────────────────────────────────────────────────
  provenance: router({
    /** Full provenance chain for a single claim */
    getChain: publicProcedure
      .input(z.object({ claimId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const { getChain, summarize } = await import(
          "./claimProvenanceService"
        );
        const chain = await getChain(input.claimId);
        const summary = summarize(chain);
        return { chain, summary };
      }),

    /** All provenance events for every claim in a document */
    getDocumentChain: publicProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const { getDocumentChain } = await import("./claimProvenanceService");
        const events = await getDocumentChain(input.documentId);
        const byClaimId = new Map<number, typeof events>();
        for (const ev of events) {
          if (!byClaimId.has(ev.claimId)) byClaimId.set(ev.claimId, []);
          byClaimId.get(ev.claimId)!.push(ev);
        }
        return {
          documentId: input.documentId,
          totalEvents: events.length,
          claimCount: byClaimId.size,
          chains: Array.from(byClaimId.entries()).map(([claimId, chain]) => ({
            claimId,
            events: chain,
          })),
        };
      }),

    /** Record a manual provenance event (admin only) */
    recordManualStep: protectedProcedure
      .input(
        z.object({
          claimId: z.number().int().positive(),
          documentId: z.number().int().positive(),
          step: z.enum([
            "extraction",
            "evidence_lookup",
            "quality_scoring",
            "verdict_override",
            "agent_ingestion",
            "similarity_check",
          ]),
          actor: z.string().min(1).max(128).optional(),
          inputSnapshot: z.record(z.string(), z.unknown()).optional(),
          outputSnapshot: z.record(z.string(), z.unknown()).optional(),
          durationMs: z.number().int().nonnegative().optional(),
          success: z.boolean().optional(),
          errorMsg: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { recordStep } = await import("./claimProvenanceService");
        const id = await recordStep({
          ...input,
          actor: input.actor ?? ctx.user.name ?? "admin",
        });
        return { id };
      }),
  }),

  // ─── Entity Co-occurrence ───────────────────────────────────────────────────────────────────────
  cooccurrence: router({
    /** Top co-occurring entity pairs (global or per-document) */
    top: publicProcedure
      .input(
        z.object({
          documentId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(200).optional().default(100),
        })
      )
      .query(async ({ input }) => {
        const { getTopCooccurrences, buildGraphData } = await import(
          "./entityCooccurrenceService"
        );
        const rows = await getTopCooccurrences({
          documentId: input.documentId,
          limit: input.limit,
        });
        return buildGraphData(rows);
      }),

    /** Co-occurrences for a specific entity */
    forEntity: publicProcedure
      .input(
        z.object({
          entityId: z.number().int().positive(),
          limit: z.number().int().min(1).max(100).optional().default(50),
        })
      )
      .query(async ({ input }) => {
        const { getCooccurrencesForEntity, buildGraphData } = await import(
          "./entityCooccurrenceService"
        );
        const rows = await getCooccurrencesForEntity(
          input.entityId,
          input.limit
        );
        return buildGraphData(rows);
      }),

    /** Trigger co-occurrence computation for a document (admin) */
    compute: protectedProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const { computeCooccurrencesForDocument } = await import(
          "./entityCooccurrenceService"
        );
        const count = await computeCooccurrencesForDocument(input.documentId);
        return { pairsUpserted: count };
      }),
  }),

  // ─── API Keys ───────────────────────────────────────────────────────────────────────
  apiKeys: router({
    /** List all active (non-revoked) API keys for the current user */
    list: protectedProcedure.query(async ({ ctx }) => {
      const { listApiKeys } = await import("./apiKeyService");
      return listApiKeys(ctx.user.id);
    }),

    /** Generate a new API key — raw key returned ONCE, plus a signed RS256 JWT bearer token */
    create: protectedProcedure
      .input(
        z.object({
          label: z.string().min(1).max(128),
          scopes: z.array(z.enum(["read", "write", "admin"])).min(1),
          expiresAt: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { generateApiKey } = await import("./apiKeyService");
        const { issueApiToken } = await import("./jwtSigner");
        const result = await generateApiKey({
          userId: ctx.user.id,
          label: input.label,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
        });
        if (!result)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to generate API key",
          });
        // Issue a signed RS256 JWT bearer token for external integrations.
        // Verifiable via /.well-known/jwks.json without calling this server.
        const expiresIn = input.expiresAt
          ? `${Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000))}s`
          : "365d";
        const bearerToken = await issueApiToken(
          {
            sub: String(ctx.user.id),
            scope: input.scopes.join(" "),
            label: input.label,
          },
          { expiresIn }
        );
        return { ...result, bearerToken };
      }),

    /** Revoke an API key by ID (must belong to current user) */
    revoke: protectedProcedure
      .input(z.object({ keyId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { revokeApiKey } = await import("./apiKeyService");
        const revoked = await revokeApiKey(input.keyId, ctx.user.id);
        if (!revoked)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API key not found or not owned by you",
          });
        return { revoked: true };
      }),

    /** Validate an API key (public — used by external callers) */
    validate: publicProcedure
      .input(z.object({ rawKey: z.string().length(64) }))
      .query(async ({ input, ctx }) => {
        const { validateApiKey } = await import("./apiKeyService");
        const callerIp =
          (ctx.req.headers["x-forwarded-for"] as string | undefined)
            ?.split(",")[0]
            ?.trim() ??
          ctx.req.socket?.remoteAddress ??
          "unknown";
        return validateApiKey(input.rawKey, callerIp);
      }),

    /**
     * Verify a RS256 JWT bearer token issued by apiKeys.create.
     * Returns the decoded payload (sub, scope, label, iat, exp) on success.
     * Throws UNAUTHORIZED if the token is invalid or expired.
     * External callers can also verify independently via /.well-known/jwks.json.
     */
    verifyBearer: publicProcedure
      .input(z.object({ token: z.string().min(10) }))
      .query(async ({ input }) => {
        const { verifyApiToken } = await import("./jwtSigner");
        try {
          const payload = await verifyApiToken(input.token);
          return { valid: true, payload };
        } catch (err) {
          return {
            valid: false,
            payload: null,
            reason: (err as Error).message,
          };
        }
      }),
  }),

  // ─── Confidence Trend ───────────────────────────────────────────────────────────────────────
  confidenceTrend: router({
    /** Full confidence history for a single claim */
    forClaim: publicProcedure
      .input(z.object({ claimId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const { getConfidenceTrend } = await import("./confidenceTrendService");
        return getConfidenceTrend(input.claimId);
      }),

    /** Latest confidence score for a claim */
    latest: publicProcedure
      .input(z.object({ claimId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const { getLatestConfidence } = await import(
          "./confidenceTrendService"
        );
        return getLatestConfidence(input.claimId);
      }),

    /** Record a new confidence score (protected — called from pipeline or admin) */
    record: protectedProcedure
      .input(
        z.object({
          claimId: z.number().int().positive(),
          documentId: z.number().int().positive(),
          score: z.number().min(0).max(1),
          trigger: z.string().max(64).optional().default("manual"),
          flags: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { recordConfidence } = await import("./confidenceTrendService");
        const id = await recordConfidence(input);
        return { id };
      }),

    /** Backfill confidence history from existing claims for a document (admin) */
    backfill: protectedProcedure
      .input(z.object({ documentId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const { backfillFromClaims } = await import("./confidenceTrendService");
        const count = await backfillFromClaims(input.documentId);
        return { inserted: count };
      }),
  }),

  // ─── Frontier Engine ───────────────────────────────────────────────────────────────────────────────────────
  selfPrompt: router({
    /** List recent self-prompt cycles */
    listCycles: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { selfPromptLog } = await import("../drizzle/schema");
        const { getDb } = await import("./db");
        const { sql: sqlFn } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(selfPromptLog)
          .orderBy(sqlFn`${selfPromptLog.createdAt} DESC`)
          .limit(input.limit);
      }),

    /** Get metrics: convergence rate, avg actions per cycle, event type breakdown */
    getMetrics: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { selfPromptLog } = await import("../drizzle/schema");
      const { getDb } = await import("./db");
      const { sql: sqlFn } = await import("drizzle-orm");
      const db = await getDb();
      if (!db)
        return {
          totalCycles: 0,
          convergenceRate: 0,
          avgActionsGenerated: 0,
          avgDurationMs: 0,
          eventBreakdown: {},
        };
      const all = await db
        .select()
        .from(selfPromptLog)
        .orderBy(sqlFn`${selfPromptLog.createdAt} DESC`)
        .limit(500);
      if (all.length === 0)
        return {
          totalCycles: 0,
          convergenceRate: 0,
          avgActionsGenerated: 0,
          avgDurationMs: 0,
          eventBreakdown: {},
        };
      const convergedCount = all.filter(
        (r: { converged: boolean | null }) => r.converged
      ).length;
      const avgActionsGenerated =
        all.reduce(
          (s: number, r: { actionCount: number | null }) =>
            s + (r.actionCount ?? 0),
          0
        ) / all.length;
      const avgDurationMs =
        all.reduce(
          (s: number, r: { durationMs: number | null }) =>
            s + (r.durationMs ?? 0),
          0
        ) / all.length;
      const eventBreakdown: Record<string, number> = {};
      for (const r of all) {
        eventBreakdown[r.eventType] = (eventBreakdown[r.eventType] ?? 0) + 1;
      }
      return {
        totalCycles: all.length,
        convergenceRate: convergedCount / all.length,
        avgActionsGenerated: Math.round(avgActionsGenerated * 10) / 10,
        avgDurationMs: Math.round(avgDurationMs),
        eventBreakdown,
      };
    }),

    /** Manually trigger a self-prompt cycle for testing */
    triggerCycle: protectedProcedure
      .input(
        z.object({
          eventType: z.enum([
            "verdict_assigned",
            "contradiction_found",
            "gap_closed",
            "source_down",
            "meta_alert",
            "user_submitted",
            "scheduled_tick",
          ]),
          description: z.string().min(1).max(500),
          claimId: z.number().optional(),
          documentId: z.number().optional(),
          gapId: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { runSelfPromptCycle } = await import("./selfPrompt/engine");
        return runSelfPromptCycle({
          type: input.eventType,
          description: input.description,
          claimId: input.claimId,
          documentId: input.documentId,
          gapId: input.gapId,
        });
      }),
  }),

  frontier: router({
    /** Run the full Frontier Engine pipeline (admin only) */
    run: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { runFrontierEngine } = await import("./frontier/frontierEngine");
      return runFrontierEngine();
    }),

    /** Get Frontier Engine metrics */
    metrics: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getFrontierMetrics } = await import("./frontier/frontierEngine");
      return getFrontierMetrics();
    }),

    /** List all knowledge gaps (paginated) */
    listGaps: protectedProcedure
      .input(
        z.object({
          status: z
            .enum([
              "open",
              "pursued",
              "narrowing",
              "closed_verified",
              "closed_resolved",
              "stale",
              "all",
            ])
            .default("all"),
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const { knowledgeGaps } = await import("../drizzle/schema");
        const { eq, sql } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return { gaps: [], total: 0 };
        const statusFilter =
          input.status === "all"
            ? undefined
            : eq(knowledgeGaps.status, input.status);
        const [gaps, countResult] = await Promise.all([
          db
            .select()
            .from(knowledgeGaps)
            .where(statusFilter)
            .orderBy(sql`priorityScore DESC`)
            .limit(input.limit)
            .offset(input.offset),
          db
            .select({ cnt: sql<number>`COUNT(*)` })
            .from(knowledgeGaps)
            .where(statusFilter),
        ]);
        return { gaps, total: countResult[0]?.cnt ?? 0 };
      }),

    /** Get full timeline for a single gap */
    gapTimeline: protectedProcedure
      .input(z.object({ gapId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getGapTimeline } = await import("./frontier/frontierEngine");
        return getGapTimeline(input.gapId);
      }),

    /** Get top N highest-priority open gaps */
    topGaps: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getTopGaps } = await import("./frontier/gapRanker");
        return getTopGaps(input.limit);
      }),

    /** Get recent frontier_log entries */
    recentLog: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const { frontierLog } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(frontierLog)
          .orderBy(frontierLog.createdAt)
          .limit(input.limit);
      }),

    /** Mark a knowledge gap as resolved by an operator */
    resolveGap: protectedProcedure
      .input(
        z.object({
          gapId: z.number().int().positive(),
          resolution: z.enum(["closed_verified", "closed_resolved", "stale"]),
          note: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const { knowledgeGaps, frontierLog: fLog } = await import(
          "../drizzle/schema"
        );
        const { eq } = await import("drizzle-orm");
        const [gap] = await db
          .select()
          .from(knowledgeGaps)
          .where(eq(knowledgeGaps.id, input.gapId))
          .limit(1);
        if (!gap)
          throw new TRPCError({ code: "NOT_FOUND", message: "Gap not found" });
        await db
          .update(knowledgeGaps)
          .set({ status: input.resolution })
          .where(eq(knowledgeGaps.id, input.gapId));
        await db.insert(fLog).values({
          actionType: "gap_closed",
          gapId: input.gapId,
          reasoning: {
            resolution: input.resolution,
            note: input.note ?? null,
            resolvedBy: ctx.user.id,
          },
          outcome: `manually_${input.resolution}`,
        });
        return {
          success: true,
          gapId: input.gapId,
          newStatus: input.resolution,
        };
      }),
  }),

  // ─── Override Audit Log ────────────────────────────────────────────────────
  overrides: router({
    /** List overrides grouped by epistemic category */
    summary: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { overrideAuditLog } = await import("../drizzle/schema");
      const { sql: sqlFn, count } = await import("drizzle-orm");
      return db
        .select({
          overrideCategory: overrideAuditLog.overrideCategory,
          total: count(),
          // count where originalVerdict != newVerdict (all overrides change verdict by definition)
          avgJustificationLength: sqlFn<number>`AVG(CHAR_LENGTH(${overrideAuditLog.justification}))`,
        })
        .from(overrideAuditLog)
        .groupBy(overrideAuditLog.overrideCategory)
        .orderBy(sqlFn`COUNT(*) DESC`);
    }),

    /** Paginated list of all override records */
    list: protectedProcedure
      .input(
        z.object({
          category: z
            .enum([
              "domain_expertise",
              "new_evidence",
              "context_clarification",
              "scope_adjustment",
              "error_correction",
            ])
            .optional(),
          limit: z.number().min(1).max(200).default(50),
          offset: z.number().min(0).default(0),
        })
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        const { overrideAuditLog } = await import("../drizzle/schema");
        const { eq, count, desc } = await import("drizzle-orm");
        const where = input.category
          ? eq(overrideAuditLog.overrideCategory, input.category)
          : undefined;
        const [{ total }] = await db
          .select({ total: count() })
          .from(overrideAuditLog)
          .where(where);
        const items = await db
          .select()
          .from(overrideAuditLog)
          .where(where)
          .orderBy(desc(overrideAuditLog.createdAt))
          .limit(input.limit)
          .offset(input.offset);
        return { items, total };
      }),

    /** Verdict flip analysis — which LLM verdicts are most often overridden */
    flipAnalysis: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { overrideAuditLog } = await import("../drizzle/schema");
      const { sql: sqlFn, count } = await import("drizzle-orm");
      return db
        .select({
          originalVerdict: overrideAuditLog.originalVerdict,
          newVerdict: overrideAuditLog.newVerdict,
          total: count(),
        })
        .from(overrideAuditLog)
        .groupBy(overrideAuditLog.originalVerdict, overrideAuditLog.newVerdict)
        .orderBy(sqlFn`COUNT(*) DESC`)
        .limit(30);
    }),
    /** Health score trend — last N meta-agent checks with health score */
    healthTrend: protectedProcedure
      .input(z.object({ days: z.number().min(1).max(90).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return [];
        const { metaAgentChecks } = await import("../drizzle/schema");
        const { gte, desc } = await import("drizzle-orm");
        const cutoff = new Date(Date.now() - input.days * 86400000);
        const rows = await db
          .select({
            id: metaAgentChecks.id,
            checkType: metaAgentChecks.checkType,
            severity: metaAgentChecks.severity,
            actionTaken: metaAgentChecks.actionTaken,
            createdAt: metaAgentChecks.createdAt,
            finding: metaAgentChecks.finding,
          })
          .from(metaAgentChecks)
          .where(gte(metaAgentChecks.createdAt, cutoff))
          .orderBy(desc(metaAgentChecks.createdAt))
          .limit(200);
        // Derive a health score per check: critical=-10, warning=-3, info=0; start at 100
        let score = 100;
        const trend = rows.reverse().map(r => {
          if (r.severity === "critical") score = Math.max(0, score - 10);
          else if (r.severity === "warning") score = Math.max(0, score - 3);
          else score = Math.min(100, score + 1);
          return {
            id: r.id,
            checkType: r.checkType,
            severity: r.severity,
            actionTaken: r.actionTaken,
            createdAt: r.createdAt,
            healthScore: score,
          };
        });
        return trend;
      }),
  }),

  inversePrompt: router({
    // List generated claims with optional status filter
    list: protectedProcedure
      .input(
        z.object({
          status: z
            .enum(["pending", "queued", "processing", "rejected", "deferred"])
            .optional(),
          inferenceType: z
            .enum(["gap_fill", "homology_projection", "contradiction_chase"])
            .optional(),
          limit: z.number().min(1).max(200).default(50),
          offset: z.number().min(0).default(0),
        })
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return { items: [], total: 0 };
        const { generatedClaims } = await import("../drizzle/schema");
        const { eq, and, count, sql } = await import("drizzle-orm");
        const conditions: ReturnType<typeof eq>[] = [];
        if (input.status)
          conditions.push(
            eq(
              generatedClaims.status,
              input.status as
                | "pending"
                | "queued"
                | "processing"
                | "rejected"
                | "deferred"
            )
          );
        if (input.inferenceType)
          conditions.push(
            eq(generatedClaims.inferenceType, input.inferenceType)
          );
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const [{ total }] = await db
          .select({ total: count() })
          .from(generatedClaims)
          .where(where);
        const items = await db
          .select()
          .from(generatedClaims)
          .where(where)
          .orderBy(
            sql`${generatedClaims.priority} DESC, ${generatedClaims.createdAt} DESC`
          )
          .limit(input.limit)
          .offset(input.offset);
        return { items, total };
      }),

    // Aggregate metrics
    metrics: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return null;
      const { generatedClaims } = await import("../drizzle/schema");
      const { count, eq } = await import("drizzle-orm");
      const [total] = await db.select({ total: count() }).from(generatedClaims);
      const [queued] = await db
        .select({ total: count() })
        .from(generatedClaims)
        .where(eq(generatedClaims.status, "queued"));
      const [rejected] = await db
        .select({ total: count() })
        .from(generatedClaims)
        .where(eq(generatedClaims.status, "rejected"));
      const [deferred] = await db
        .select({ total: count() })
        .from(generatedClaims)
        .where(eq(generatedClaims.status, "deferred"));
      const [gapFill] = await db
        .select({ total: count() })
        .from(generatedClaims)
        .where(eq(generatedClaims.inferenceType, "gap_fill"));
      const [homology] = await db
        .select({ total: count() })
        .from(generatedClaims)
        .where(eq(generatedClaims.inferenceType, "homology_projection"));
      const [contradiction] = await db
        .select({ total: count() })
        .from(generatedClaims)
        .where(eq(generatedClaims.inferenceType, "contradiction_chase"));
      return {
        total: total.total,
        queued: queued.total,
        rejected: rejected.total,
        deferred: deferred.total,
        byInferenceType: {
          gap_fill: gapFill.total,
          homology_projection: homology.total,
          contradiction_chase: contradiction.total,
        },
      };
    }),

    // Trigger a full Inverse Prompt Engine run (admin only)
    trigger: protectedProcedure
      .input(z.object({ topN: z.number().min(1).max(100).default(20) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { runInversePromptEngine } = await import(
          "./inversePrompt/inversePromptEngine"
        );
        const result = await runInversePromptEngine(input.topN);
        return result;
      }),
  }),

  // ─── Autonomous Loop ───────────────────────────────────────────────────────
  autonomousLoop: router({
    // Get current loop status: safe mode, last run, event counts
    status: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getDb } = await import("./db");
      const { loopRun, loopConfig, eventQueue } = await import(
        "../drizzle/schema"
      );
      const { desc, count, sql: sqlFn } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [lastRun] = await db
        .select()
        .from(loopRun)
        .orderBy(desc(loopRun.createdAt))
        .limit(1);
      const [cfg] = await db.select().from(loopConfig).limit(1);
      const [eventStats] = await db
        .select({
          total: count(),
          pending: sqlFn<number>`SUM(CASE WHEN ${eventQueue.status} = 'pending' THEN 1 ELSE 0 END)`,
        })
        .from(eventQueue);
      return {
        safeMode: cfg?.safeMode ?? false,
        lastRun: lastRun ?? null,
        totalEvents: Number(eventStats?.total ?? 0),
        pendingEvents: Number(eventStats?.pending ?? 0),
      };
    }),

    // Get recent event log with filtering
    eventLog: protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(200).default(50),
          eventType: z.string().optional(),
          status: z
            .enum(["pending", "processing", "complete", "failed", "skipped"])
            .optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const { eventQueue } = await import("../drizzle/schema");
        const { desc, eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const conditions = [];
        if (input.eventType)
          conditions.push(eq(eventQueue.eventType, input.eventType as never));
        if (input.status)
          conditions.push(
            eq(
              eventQueue.status,
              input.status === "complete"
                ? "processed"
                : (input.status as never)
            )
          );
        const rows = await db
          .select()
          .from(eventQueue)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(eventQueue.createdAt))
          .limit(input.limit);
        return rows;
      }),

    // Get recent loop run history
    runHistory: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const { loopRun } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return db
          .select()
          .from(loopRun)
          .orderBy(desc(loopRun.createdAt))
          .limit(input.limit);
      }),

    // Manually trigger an event through the loop
    triggerEvent: protectedProcedure
      .input(
        z.object({
          eventType: z.string(),
          payload: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { publishEvent } = await import("./autonomousLoop/eventBus");
        const { processEvent } = await import(
          "./autonomousLoop/loopOrchestrator"
        );
        const eventId = await publishEvent(
          input.eventType as never,
          input.payload ?? {}
        );
        // Fetch the event and process it immediately
        const { getDb } = await import("./db");
        const { eventQueue: eq2 } = await import("../drizzle/schema");
        const { eq: eqFn } = await import("drizzle-orm");
        const db2 = await getDb();
        if (!db2) return { eventId, result: null };
        const [event] = await db2
          .select()
          .from(eq2)
          .where(eqFn(eq2.id, eventId))
          .limit(1);
        const result = event ? await processEvent(event as never) : null;
        return { eventId, result };
      }),

    // Toggle safe mode
    setSafeMode: protectedProcedure
      .input(z.object({ enabled: z.boolean(), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { enterSafeMode, exitSafeMode } = await import(
          "./autonomousLoop/safeModeController"
        );
        if (input.enabled) {
          await enterSafeMode(input.reason ?? "Manual toggle by admin");
        } else {
          await exitSafeMode();
        }
        return { safeMode: input.enabled };
      }),

    // Process all pending events (batch drain)
    drainQueue: protectedProcedure
      .input(z.object({ maxEvents: z.number().min(1).max(50).default(10) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { processEvent } = await import(
          "./autonomousLoop/loopOrchestrator"
        );
        const { getDb } = await import("./db");
        const { eventQueue: eq3 } = await import("../drizzle/schema");
        const { eq: eqFn3 } = await import("drizzle-orm");
        const db3 = await getDb();
        if (!db3) return { processed: 0, results: [] };
        const results = [];
        for (let i = 0; i < input.maxEvents; i++) {
          const [nextEvent] = await db3
            .select()
            .from(eq3)
            .where(eqFn3(eq3.status, "pending"))
            .limit(1);
          if (!nextEvent) break;
          const result = await processEvent(nextEvent as never);
          results.push(result);
        }
        return { processed: results.length, results };
      }),
  }),

  // ─── Dream State ─────────────────────────────────────────────────────────────
  dream: router({
    // Get recent dream sessions
    getSessions: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getRecentDreamSessions } = await import("./dream/dreamEngine");
        return getRecentDreamSessions(input.limit);
      }),

    // Get a single dream session by ID
    getSession: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDreamSession } = await import("./dream/dreamEngine");
        const session = await getDreamSession(input.id);
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        return session;
      }),

    // Get aggregate dream stats
    getStats: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getDreamStats } = await import("./dream/dreamEngine");
      return getDreamStats();
    }),

    // Check dream eligibility
    checkEligibility: protectedProcedure
      .input(z.object({ healthScore: z.number().min(0).max(100).default(80) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { checkDreamEligibility } = await import("./dream/dreamEngine");
        return checkDreamEligibility(input.healthScore);
      }),

    // Manually trigger a dream session
    triggerSession: protectedProcedure
      .input(z.object({ healthScore: z.number().min(0).max(100).default(80) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { runDreamSession } = await import("./dream/dreamEngine");
        const result = await runDreamSession({
          healthScore: input.healthScore,
          manualTrigger: true,
        });
        if (!result)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Dream session failed to start",
          });
        return result;
      }),
  }),

  // ── Cron Health Dashboard ────────────────────────────────────────────────────────────────────────────────────
  crons: router({
    /** List all heartbeat jobs with their status. Admin-only. */
    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { listHeartbeatJobs } = await import("./_core/heartbeat");
      return listHeartbeatJobs("");
    }),
    /** Trigger a heartbeat job to run immediately. Admin-only. */
    runNow: protectedProcedure
      .input(z.object({ taskUid: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { ENV } = await import("./_core/env");
        const resp = await fetch(
          `${ENV.forgeApiUrl}/webdev.v1.WebDevHeartbeatService/RunHeartbeatJobNow`,
          {
            method: "POST",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${ENV.forgeApiKey}`,
              "content-type": "application/json",
              "connect-protocol-version": "1",
            },
            body: JSON.stringify({ taskUid: input.taskUid }),
          }
        );
        if (!resp.ok) {
          const detail = await resp.text().catch(() => "");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `RunNow failed: ${detail}`,
          });
        }
        return { success: true };
      }),
    /** Get the last N run records for a specific job (or all jobs). Admin-only. */
    history: protectedProcedure
      .input(
        z.object({
          jobName: z.string().max(128).optional(),
          limit: z.number().int().min(1).max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return [];
        const { cronRunLog } = await import("../drizzle/schema");
        const { desc, eq } = await import("drizzle-orm");
        const query = db
          .select()
          .from(cronRunLog)
          .orderBy(desc(cronRunLog.ranAt))
          .limit(input.limit);
        if (input.jobName) {
          return query.where(eq(cronRunLog.jobName, input.jobName));
        }
        return query;
      }),
  }),

  // ── Vertical Expansion Wizard ─────────────────────────────────────────────────────────────────────────────
  verticalConfigs: router({
    /** List all admin-managed vertical configs. Admin-only. */
    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return [];
      const { verticalConfigs } = await import("../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      return db
        .select()
        .from(verticalConfigs)
        .orderBy(desc(verticalConfigs.createdAt));
    }),
    /** Create a new vertical config. Admin-only. */
    create: protectedProcedure
      .input(
        z.object({
          domainKey: z
            .string()
            .min(2)
            .max(64)
            .regex(/^[a-z0-9_]+$/),
          displayName: z.string().min(2).max(128),
          description: z.string().max(1024).optional(),
          meshTerms: z.array(z.string()).default([]),
          sourceWhitelist: z.array(z.string()).default([]),
          qualityTier: z.enum(["draft", "verified"]).default("draft"),
          enabled: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const { verticalConfigs } = await import("../drizzle/schema");
        await db.insert(verticalConfigs).values({
          domainKey: input.domainKey,
          displayName: input.displayName,
          description: input.description ?? null,
          meshTerms: input.meshTerms,
          sourceWhitelist: input.sourceWhitelist,
          qualityTier: input.qualityTier,
          enabled: input.enabled,
        });
        return { success: true, domainKey: input.domainKey };
      }),
    /** Update an existing vertical config. Admin-only. */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          displayName: z.string().min(2).max(128).optional(),
          description: z.string().max(1024).optional(),
          meshTerms: z.array(z.string()).optional(),
          sourceWhitelist: z.array(z.string()).optional(),
          qualityTier: z.enum(["draft", "verified"]).optional(),
          enabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const { verticalConfigs } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const patch: Record<string, unknown> = {};
        if (input.displayName !== undefined)
          patch.displayName = input.displayName;
        if (input.description !== undefined)
          patch.description = input.description;
        if (input.meshTerms !== undefined) patch.meshTerms = input.meshTerms;
        if (input.sourceWhitelist !== undefined)
          patch.sourceWhitelist = input.sourceWhitelist;
        if (input.qualityTier !== undefined)
          patch.qualityTier = input.qualityTier;
        if (input.enabled !== undefined) patch.enabled = input.enabled;
        if (Object.keys(patch).length === 0) return { success: true };
        await db
          .update(verticalConfigs)
          .set(patch)
          .where(eq(verticalConfigs.id, input.id));
        return { success: true };
      }),
  }),

  // ── Source Whitelist ────────────────────────────────────────────────────────────────────────────────────
  sources: router({
    /**
     * List all sources in the whitelist with their metadata.
     * Approved and pending sources are both returned; UI filters by status.
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { SOURCE_WHITELIST } = await import("./sourceRegistry");
      return SOURCE_WHITELIST.map(s => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
        apiBaseUrl: s.apiBaseUrl,
        schema: s.schema,
        failureMode: s.failureMode,
        approved: s.approved,
        approvedAt: s.approvedAt,
      }));
    }),

    /**
     * Run a live health check against a single source.
     */
    healthCheck: protectedProcedure
      .input(z.object({ sourceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { runHealthCheck } = await import("./sourceRegistry");
        const result = await runHealthCheck(input.sourceId);
        if (!result)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Source "${input.sourceId}" not found in whitelist`,
          });
        return result;
      }),

    /**
     * Run health checks against all sources simultaneously.
     */
    healthCheckAll: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { runAllHealthChecks } = await import("./sourceRegistry");
      return runAllHealthChecks();
    }),
    /**
     * Approve a pending source for production use.
     */
    approve: protectedProcedure
      .input(z.object({ sourceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { approveSource } = await import("./sourceRegistry");
        const ok = approveSource(input.sourceId);
        if (!ok)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Source "${input.sourceId}" not found`,
          });
        return { success: true, sourceId: input.sourceId };
      }),
    /**
     * Reject (un-approve) a source, removing it from production use.
     */
    reject: protectedProcedure
      .input(z.object({ sourceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { rejectSource } = await import("./sourceRegistry");
        const ok = rejectSource(input.sourceId);
        if (!ok)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Source "${input.sourceId}" not found`,
          });
        return { success: true, sourceId: input.sourceId };
      }),
  }),

  // ─── Deployment (Micron + Private) ────────────────────────────────────────────────
  deployment: router({
    deploy: protectedProcedure
      .input(
        z.object({
          verticalKey: z.string(),
          displayName: z.string(),
          deployTarget: z.enum(["vercel", "netlify", "docker", "ipfs"]),
          domain: z.string().optional(),
          deployConfig: z.record(z.string(), z.string()).optional(),
          apiBase: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createMicronDeployment, deployMicron } = await import(
          "./micronDeploy"
        );
        const deployment = await createMicronDeployment({
          verticalKey: input.verticalKey,
          displayName: input.displayName,
          domain: input.domain,
          deployTarget: input.deployTarget,
          config: (input.deployConfig ?? {}) as Record<string, string>,
          userId: ctx.user.id,
        });
        deployMicron({
          deploymentId: deployment.id,
          verticalKey: input.verticalKey,
          displayName: input.displayName,
          domain: input.domain,
          deployTarget: input.deployTarget,
          config: (input.deployConfig ?? {}) as Record<string, string>,
          apiBase: input.apiBase ?? "",
        }).catch(console.error);
        return { deploymentId: deployment.id, status: "building" };
      }),
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getMicronDeploymentsByUser } = await import("./micronDeploy");
      return getMicronDeploymentsByUser(ctx.user.id);
    }),
    listAll: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getAllMicronDeployments } = await import("./micronDeploy");
      return getAllMicronDeployments();
    }),
    generateDockerCompose: protectedProcedure
      .input(
        z.object({
          verticalKey: z.string(),
          domain: z.string().optional(),
          includeLocalDb: z.boolean().optional(),
          includeNginx: z.boolean().optional(),
          includeSaml: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { generateDockerCompose, generateNginxConfig } = await import(
          "./privateMode"
        );
        return {
          composeYml: generateDockerCompose(input),
          nginxConf: input.includeNginx
            ? generateNginxConfig({ domain: input.domain ?? "localhost" })
            : null,
        };
      }),
    generateSiteHtml: protectedProcedure
      .input(
        z.object({
          verticalKey: z.string(),
          displayName: z.string(),
          domain: z.string().optional(),
          apiBase: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { generateSiteConfig, generateSiteHtml } = await import(
          "./micronDeploy"
        );
        const config = generateSiteConfig({
          verticalKey: input.verticalKey,
          displayName: input.displayName,
          domain: input.domain,
          apiBase: input.apiBase ?? "",
        });
        return { html: generateSiteHtml(config), config };
      }),
  }),

  // ─── Discovery Engine ──────────────────────────────────────────────────────
  discovery: router({
    run: protectedProcedure
      .input(
        z.object({
          verticalKey: z.string(),
          skipProbe: z.boolean().optional(),
          skipCodegen: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { createDiscoveryRun, runDiscovery } = await import(
          "./discoveryEngine"
        );
        const runId = await createDiscoveryRun(input.verticalKey);
        runDiscovery({
          runId,
          verticalKey: input.verticalKey,
          skipProbe: input.skipProbe,
          skipCodegen: input.skipCodegen,
        }).catch(console.error);
        return { runId, status: "running" };
      }),
    get: protectedProcedure
      .input(z.object({ runId: z.number() }))
      .query(async ({ input }) => {
        const { getDiscoveryRun } = await import("./discoveryEngine");
        const run = await getDiscoveryRun(input.runId);
        if (!run) throw new TRPCError({ code: "NOT_FOUND" });
        return run;
      }),
    sources: protectedProcedure
      .input(z.object({ verticalKey: z.string() }))
      .query(async ({ input }) => {
        const { getRegistryEntriesByVertical } = await import(
          "./discoveryEngine"
        );
        return getRegistryEntriesByVertical(input.verticalKey);
      }),
    builtInSources: protectedProcedure
      .input(
        z.object({
          verticalKey: z.string().optional(),
          category: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        const { BUILT_IN_SOURCES } = await import("./discoveryEngine");
        let sources = BUILT_IN_SOURCES;
        if (input.verticalKey)
          sources = sources.filter(s =>
            s.verticals.includes(input.verticalKey!)
          );
        if (input.category)
          sources = sources.filter(s => s.category === input.category);
        return sources;
      }),
    probe: protectedProcedure
      .input(z.object({ sourceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const { BUILT_IN_SOURCES, probeSource } = await import(
          "./discoveryEngine"
        );
        const source = BUILT_IN_SOURCES.find(
          s => s.sourceId === input.sourceId
        );
        if (!source) throw new TRPCError({ code: "NOT_FOUND" });
        return probeSource(source);
      }),
    allSources: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getAllRegistryEntries } = await import("./discoveryEngine");
      return getAllRegistryEntries();
    }),
  }),

  // ─── Saved Research ──────────────────────────────────────────────────────────────────────
  savedResearch: router({
    save: protectedProcedure
      .input(
        z.object({
          question: z.string().min(1).max(2000),
          claimsJson: z.array(z.unknown()),
          totalPapers: z.number().int().min(0),
          supportedClaims: z.number().int().min(0),
          claimsAnalysed: z.number().int().min(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const { savedResearch } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        const result = await db.insert(savedResearch).values({
          userId: ctx.user.id,
          question: input.question,
          claimsJson: input.claimsJson,
          totalPapers: input.totalPapers,
          supportedClaims: input.supportedClaims,
          claimsAnalysed: input.claimsAnalysed,
        });
        return {
          id: (result as unknown as { insertId: number }).insertId,
          saved: true,
        };
      }),
    list: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).optional() }))
      .query(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const { savedResearch } = await import("../drizzle/schema");
        const { desc, eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(savedResearch)
          .where(eq(savedResearch.userId, ctx.user.id))
          .orderBy(desc(savedResearch.createdAt))
          .limit(input.limit ?? 50);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const { savedResearch } = await import("../drizzle/schema");
        const { and, eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });
        await db
          .delete(savedResearch)
          .where(
            and(
              eq(savedResearch.id, input.id),
              eq(savedResearch.userId, ctx.user.id)
            )
          );
        return { deleted: true };
      }),
  }),

  // ─── Chat ────────────────────────────────────────────────────────────────
  chat: router({
    /**
     * Translates a plain-language question into verifiable claims,
     * runs each claim through the evidence pipeline, and returns
     * a structured answer with cited PubMed results.
     */
    query: publicProcedure
      .input(z.object({ question: z.string().min(3).max(2000) }))
      .mutation(async ({ input }) => {
        const { question } = input;

        // 1. Translate natural language → structured claims
        let claims: Awaited<ReturnType<typeof translateQueryToClaims>>;
        try {
          claims = await translateQueryToClaims(question);
        } catch {
          claims = [];
        }

        if (claims.length === 0) {
          return {
            question,
            claims: [],
            summary:
              "I could not extract any verifiable scientific claims from your question. Try rephrasing with specific protein names, organisms, or biological processes.",
          };
        }

        // 2. For each claim: fetch PubMed evidence + run verdict in parallel
        const claimResults = await Promise.all(
          claims.slice(0, 5).map(async claim => {
            const [pubmedResults, verdict] = await Promise.allSettled([
              fetchPubMedResults(claim.searchQuery, 3),
              verdictForClaim({
                claimType: claim.proteinName ? "protein_name" : "general",
                proteinName: claim.proteinName,
                organism: claim.organism,
              }),
            ]);
            return {
              claimText: claim.claimText,
              verdict:
                verdict.status === "fulfilled"
                  ? verdict.value.verdict
                  : ("Insufficient Evidence" as const),
              rationale:
                verdict.status === "fulfilled" ? verdict.value.rationale : "",
              evidenceUrl:
                verdict.status === "fulfilled"
                  ? verdict.value.evidenceUrl
                  : null,
              pubmedResults:
                pubmedResults.status === "fulfilled" ? pubmedResults.value : [],
            };
          })
        );

        // 3. Fire-and-forget: trigger autonomous ingest for background enrichment
        triggerAutonomousIngest({
          query: question,
          pubmedResults: claimResults.flatMap(c => c.pubmedResults),
        });

        // 4. Build a human-readable summary via LLM
        const claimSummaryText = claimResults
          .map(
            (c, i) =>
              `Claim ${i + 1}: "${c.claimText}"\nVerdict: ${c.verdict}\n${c.rationale}\nTop evidence: ${c.pubmedResults
                .slice(0, 2)
                .map(p => `${p.title} (PMID:${p.pmid})`)
                .join("; ")}`
          )
          .join("\n\n");

        let summary = "";
        try {
          const llmResponse = await invokeLLM({
            messages: [
              {
                role: "system",
                content:
                  "You are Truth Desk AI, a scientific evidence engine. Given a user question and structured claim verdicts with PubMed citations, write a concise, accurate answer in 2-4 paragraphs. Always cite PMIDs inline like (PMID:12345678). Be direct about what the evidence supports, contradicts, or leaves ambiguous. Never fabricate citations.",
              },
              {
                role: "user",
                content: `Question: ${question}\n\nEvidence:\n${claimSummaryText}`,
              },
            ],
          });
          summary =
            (llmResponse.choices?.[0]?.message?.content as string) ?? "";
        } catch {
          summary = claimSummaryText;
        }

        return { question, claims: claimResults, summary };
      }),
  }),

  // ─── Embed ────────────────────────────────────────────────────────────────
  embed: router({
    generateCode: protectedProcedure
      .input(
        z.object({
          vertical: z.string(),
          theme: z.enum(["auto", "light", "dark"]).optional(),
          position: z
            .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
            .optional(),
          apiBase: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        const {
          vertical,
          theme = "auto",
          position = "bottom-right",
          apiBase = "",
        } = input;
        const base = apiBase || "https://protein-desk-5r5rzpyg.manus.space";
        return {
          iframeCode: `<!-- Truth Desk Embed Widget -->\n<iframe\n  src="${base}/api/embed/frame?vertical=${vertical}&theme=${theme}"\n  width="400" height="440" frameborder="0"\n  style="border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.15);"\n  title="Truth Desk Claim Verifier"\n  sandbox="allow-scripts allow-same-origin allow-popups"\n></iframe>`,
          sdkCode: `<!-- Truth Desk Floating Widget SDK -->\n<script>\n  window.TruthDesk = { config: { vertical: '${vertical}', theme: '${theme}', position: '${position}', apiBase: '${base}' } };\n</script>\n<script src="${base}/embed/sdk.js" async></script>`,
          previewUrl: `${base}/api/embed/frame?vertical=${vertical}&theme=${theme}`,
        };
      }),
  }),
});
export type AppRouter = typeof appRouter;
