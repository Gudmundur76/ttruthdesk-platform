import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createDocument,
  getDocumentById,
  getDocumentsByUser,
  updateDocumentStatus,
  insertClaims,
  getClaimsByDocument,
  overrideClaimVerdict,
  upsertAuditReport,
  getAuditReportByDocument,
  createAuditRequest,
  getAllAuditRequests,
  markAuditRequestOwnerNotified,
  getMonitoringFeedByDocument,
  getAllMonitoringFeed,
  insertMonitoringItems,
} from "./db";
import { extractClaims } from "./claimExtractor";
import { verdictForClaim } from "./pdbAdapter";
import { generateHtmlReport, buildVerdictSummary, countHighRisk } from "./reportGenerator";
import { storagePut } from "./storage";
import { notifyOwner } from "./_core/notification";
import { invokeLLM } from "./_core/llm";

// ─── Analysis pipeline ────────────────────────────────────────────────────────
async function runAnalysisPipeline(documentId: number, rawText: string, userId: number) {
  try {
    // 1. Extract claims
    await updateDocumentStatus(documentId, "extracting");
    const extracted = await extractClaims(rawText);

    // 2. Insert claims into DB
    const claimInserts = extracted.map((c) => ({
      documentId,
      claimText: c.claimText,
      claimType: c.claimType,
      extractedValue: c.extractedValue,
      pdbId: c.pdbId,
      proteinName: c.proteinName,
      experimentalMethod: c.experimentalMethod,
      resolution: c.resolution,
      organism: c.organism,
      ligand: c.ligand,
    }));
    await insertClaims(claimInserts as never);
    await updateDocumentStatus(documentId, "validating", { claimCount: extracted.length });

    // 3. Validate each claim against PDB
    const allClaims = await getClaimsByDocument(documentId);
    for (const claim of allClaims) {
      const result = await verdictForClaim({
        claimType: claim.claimType,
        pdbId: claim.pdbId,
        proteinName: claim.proteinName,
        experimentalMethod: claim.experimentalMethod,
        resolution: claim.resolution ?? undefined,
        organism: claim.organism,
        ligand: claim.ligand,
        extractedValue: claim.extractedValue,
      });
      await import("./db").then((db) =>
        db.updateClaimVerdict(claim.id, {
          verdict: result.verdict,
          verdictRationale: result.rationale,
          pdbEvidenceUrl: result.evidenceUrl ?? undefined,
          pdbEvidenceRaw: result.evidenceRaw ?? undefined,
          pdbEvidenceCheckedAt: new Date(),
        })
      );
    }

    // 4. Generate report
    await updateDocumentStatus(documentId, "generating_report");
    const doc = await getDocumentById(documentId);
    const finalClaims = await getClaimsByDocument(documentId);
    const summary = buildVerdictSummary(finalClaims as never);
    const highRisk = countHighRisk(finalClaims as never);

    const htmlContent = generateHtmlReport({
      documentTitle: doc?.title ?? "Untitled",
      documentUrl: doc?.storageUrl ?? null,
      claims: finalClaims as never,
      generatedAt: new Date(),
      reportId: documentId,
    });

    // 5. Store HTML report
    const htmlKey = `reports/${userId}/${documentId}/audit-report.html`;
    const { url: htmlUrl } = await storagePut(htmlKey, Buffer.from(htmlContent, "utf-8"), "text/html");

    // 6. Upsert audit report record
    await upsertAuditReport({
      documentId,
      userId,
      htmlStorageKey: htmlKey,
      htmlStorageUrl: htmlUrl,
      verdictSummary: summary,
      highRiskCount: highRisk,
      totalClaims: finalClaims.length,
    });

    await updateDocumentStatus(documentId, "complete", { claimCount: finalClaims.length });
    // Notify owner that report is ready
    const supportedCount = (summary as Record<string, number>)["Supported"] ?? 0;
    const contradictedCount = (summary as Record<string, number>)["Contradicted"] ?? 0;
    await notifyOwner({
      title: `Audit Report Ready: ${doc?.title ?? "Untitled"}`,
      content: `Document audit complete.\n\nClaims: ${finalClaims.length} total\nSupported: ${supportedCount}\nContradicted: ${contradictedCount}\nHigh-risk: ${highRisk}\n\nReport: ${htmlUrl}`,
    }).catch(() => {/* non-fatal */});
  } catch (err) {
    console.error("[Pipeline] Error:", err);
    await updateDocumentStatus(documentId, "failed", {
      errorMessage: String(err).substring(0, 500),
    });
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
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
        if (!doc || doc.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        return doc;
      }),

    submitText: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(512),
          text: z.string().min(10),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const docId = await createDocument({
          userId: ctx.user.id,
          title: input.title,
          sourceType: "paste",
          rawText: input.text,
        });
        // Run pipeline async (fire and forget)
        runAnalysisPipeline(docId, input.text, ctx.user.id).catch(console.error);
        return { documentId: docId };
      }),

    submitFile: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(512),
          fileName: z.string(),
          storageKey: z.string(),
          storageUrl: z.string(),
          rawText: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const docId = await createDocument({
          userId: ctx.user.id,
          title: input.title,
          sourceType: "upload",
          originalFileName: input.fileName,
          storageKey: input.storageKey,
          storageUrl: input.storageUrl,
          rawText: input.rawText,
        });
        runAnalysisPipeline(docId, input.rawText, ctx.user.id).catch(console.error);
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
          query: z.string().min(1).max(512).describe("PMID, DOI, or PubMed URL"),
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
            message: "Please enter a valid PubMed ID (e.g. 37234567), DOI (e.g. 10.1038/s41586-023-06415-8), or PubMed URL.",
          });
        }

        // ── Fetch via PubMed E-utilities ──────────────────────────────────────
        try {
          // If we have a DOI, resolve to PMID first via E-search
          if (!pmid && doi) {
            const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doi)}[doi]&retmode=json&retmax=1&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json() as { esearchresult?: { idlist?: string[] } };
            const ids = searchData?.esearchresult?.idlist ?? [];
            if (ids.length > 0) pmid = ids[0];
          }

          if (pmid) {
            // Fetch full abstract + metadata via efetch
            const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
            const fetchRes = await fetch(fetchUrl);
            const xml = await fetchRes.text();

            // Extract title
            const titleMatch = xml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "Untitled Paper";

            // Extract abstract sections
            const abstractTexts: string[] = [];
            const abstractMatches = Array.from(xml.matchAll(/<AbstractText(?:[^>]* Label="([^"]*)"|[^>]*)>([\s\S]*?)<\/AbstractText>/g));
            for (const m of abstractMatches) {
              const label = m[1] ? `${m[1]}: ` : "";
              const text = m[2].replace(/<[^>]+>/g, "").trim();
              if (text) abstractTexts.push(label + text);
            }

            // Extract author list
            const authorMatches = Array.from(xml.matchAll(/<LastName>([^<]+)<\/LastName>/g));
            const authors = authorMatches.slice(0, 6).map((m) => m[1]).join(", ");
            const authorSuffix = authorMatches.length > 6 ? " et al." : "";

            // Extract journal + year
            const journalMatch = xml.match(/<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/);
            const yearMatch = xml.match(/<PubDate>[\s\S]*?<Year>([0-9]{4})<\/Year>/);
            const citation = [
              authors ? `${authors}${authorSuffix}` : "",
              journalMatch ? journalMatch[1] : "",
              yearMatch ? `(${yearMatch[1]})` : "",
              pmid ? `PMID: ${pmid}` : "",
            ].filter(Boolean).join(" · ");

            const fullText = [
              `Title: ${title}`,
              citation ? `Citation: ${citation}` : "",
              "",
              abstractTexts.length > 0
                ? abstractTexts.join("\n\n")
                : "[Abstract not available — please paste the text manually]",
            ].filter((l) => l !== undefined).join("\n");

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
              `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(doi ? `DOI:${doi}` : `EXT_ID:${pmid}`)}&format=json&resultType=core&pageSize=1`
            );
            const epmcData = await epmc.json() as { resultList?: { result?: Array<{ title?: string; abstractText?: string; authorString?: string; journalAbbreviation?: string; pubYear?: string; doi?: string }> } };
            const result = epmcData?.resultList?.result?.[0];
            if (result) {
              const title = result.title ?? "Untitled Paper";
              const text = [
                `Title: ${title}`,
                result.authorString ? `Authors: ${result.authorString}` : "",
                result.journalAbbreviation ? `Journal: ${result.journalAbbreviation} (${result.pubYear ?? ""})` : "",
                result.doi ? `DOI: ${result.doi}` : "",
                "",
                result.abstractText ?? "[Abstract not available — please paste the text manually]",
              ].filter(Boolean).join("\n");
              return { title, text, pmid: pmid ?? null, doi: result.doi ?? doi ?? null, citation: `${result.authorString ?? ""} · ${result.journalAbbreviation ?? ""} (${result.pubYear ?? ""})` };
            }
          }
        } catch (err) {
          console.error("Europe PMC fallback error:", err);
        }

        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Could not retrieve this paper. It may not be indexed in PubMed or Europe PMC. Please paste the text manually.",
        });
      }),
  }),

  // ─── Claims ─────────────────────────────────────────────────────────────────
  claims: router({
    byDocument: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
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
          reviewNotes: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        await overrideClaimVerdict(
          input.claimId,
          ctx.user.id,
          input.overriddenVerdict,
          input.reviewNotes
        );
        return { success: true };
      }),
  }),

  // ─── Reports ─────────────────────────────────────────────────────────────────
  reports: router({
    byDocument: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        return getAuditReportByDocument(input.documentId);
      }),

    regenerate: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (!doc.rawText) throw new TRPCError({ code: "BAD_REQUEST", message: "No text available" });
        runAnalysisPipeline(input.documentId, doc.rawText, ctx.user.id).catch(console.error);
        return { success: true };
      }),
  }),

  // ─── Monitoring Feed ──────────────────────────────────────────────────────────
  monitoring: router({
    byDocument: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .query(async ({ ctx, input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc || doc.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
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
          contactName: z.string().min(1),
          contactEmail: z.string().email(),
          organization: z.string().optional(),
          documentDescription: z.string().min(10),
          additionalNotes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
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
  ingestMonitoring: publicProcedure
    .input(
      z.object({
        documentId: z.number(),
        items: z.array(
          z.object({
            source: z.enum(["pubmed", "biorxiv", "patent"]),
            title: z.string(),
            summary: z.string().optional(),
            url: z.string().optional(),
            relevanceScore: z.number().optional(),
            publishedAt: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      await insertMonitoringItems(
        input.items.map((item) => ({
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
          fileName: z.string(),
          contentType: z.string(),
          base64Content: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const key = `documents/${ctx.user.id}/${Date.now()}-${input.fileName}`;
        const buffer = Buffer.from(input.base64Content, "base64");
        const { url } = await storagePut(key, buffer, input.contentType);
        return { key, url };
      }),
  }),

  // ─── LLM text extraction from PDF text ────────────────────────────────────
  extractText: protectedProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input }) => {
      // Simple pass-through — text is already extracted client-side
      return { text: input.text };
    }),
});

export type AppRouter = typeof appRouter;
