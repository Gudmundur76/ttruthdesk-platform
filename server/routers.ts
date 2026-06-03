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
  getGraphData,
  getVerticalStats,
  getRecentAuditRequestsByEmail,
  getAllGraphEntities,
  getAllGraphRelations,
  getContradictionRelations,
} from "./db";
import { invokeLLM } from "./_core/llm";
import { fetchWikiPage } from "./wikiCompiler";
import { checkAuditLimit } from "./academicDomains";
import { getEmailUserById, incrementEmailUserAuditCount } from "./db";
import { notifyOwner } from "./_core/notification";
import { runAnalysisPipeline } from "./analysisPipeline";
import { storagePut } from "./storage";
import {
  createPayPalOrder,
  capturePayPalOrder,
  getActiveSubscription,
  checkPayPalAuditLimit,
  PLANS,
} from "./paypalCheckout";
import type { PlanTier } from "./paypalCheckout";

// ─── Router ────────────────────────────────────────────────────────
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
        // Plan enforcement for email users
        if (ctx.user.openId?.startsWith("email_")) {
          const emailUserId = parseInt(ctx.user.openId.replace("email_", ""), 10);
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
        });
        // Increment audit count for email users
        if (ctx.user.openId?.startsWith("email_")) {
          const emailUserId = parseInt(ctx.user.openId.replace("email_", ""), 10);
          await incrementEmailUserAuditCount(emailUserId).catch(() => {});
        }
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
        // Plan enforcement for email users
        if (ctx.user.openId?.startsWith("email_")) {
          const emailUserId = parseInt(ctx.user.openId.replace("email_", ""), 10);
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
        });
        // Increment audit count for email users
        if (ctx.user.openId?.startsWith("email_")) {
          const emailUserId = parseInt(ctx.user.openId.replace("email_", ""), 10);
          await incrementEmailUserAuditCount(emailUserId).catch(() => {});
        }
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

                        // ── PMC Open Access full-text fetch ──────────────────────────
            let methodsText = "";
            try {
              // Check if this PMID has a PMC full-text record
              const pmcSearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?dbfrom=pubmed&db=pmc&id=${pmid}&retmode=json&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
              const pmcLinkRes = await fetch(pmcSearchUrl);
              const pmcLinkData = await pmcLinkRes.json() as { linksets?: Array<{ linksetdbs?: Array<{ dbto: string; links?: string[] }> }> };
              const pmcLinks = pmcLinkData?.linksets?.[0]?.linksetdbs?.find((db) => db.dbto === "pmc")?.links ?? [];
              if (pmcLinks.length > 0) {
                const pmcId = pmcLinks[0];
                const ftUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${pmcId}&rettype=full&retmode=xml&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
                const ftRes = await fetch(ftUrl);
                const ftXml = await ftRes.text();
                // Extract Methods section text
                const methodsMatch = ftXml.match(/<sec[^>]*>\s*<title>[^<]*(?:method|material|experiment)[^<]*<\/title>([\s\S]*?)<\/sec>/i);
                if (methodsMatch) {
                  methodsText = methodsMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
                }
              }
            } catch (_pmcErr) {
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
            ].filter((l) => l !== undefined && l !== "").join("\n");
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
      .mutation(async ({ ctx, input }) => {
        // Rate limit: max 3 audit requests per email per 24 hours
        const recentRequests = await getRecentAuditRequestsByEmail(input.contactEmail, 24 * 60 * 60 * 1000);
        if (recentRequests >= 3) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many requests. Please wait 24 hours before submitting another audit request.",
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

  // ─── Knowledge Graph ─────────────────────────────────────────────────────
  graph: router({
    data: publicProcedure.query(async () => {
      return getGraphData();
    }),

    entities: publicProcedure.query(async () => {
      const [entities, relations] = await Promise.all([
        getAllGraphEntities(500),
        getAllGraphRelations(2000),
      ]);
      // Attach relation counts to each entity
      const relCount = new Map<number, number>();
      for (const r of relations) {
        relCount.set(r.sourceEntityId, (relCount.get(r.sourceEntityId) ?? 0) + 1);
        relCount.set(r.targetEntityId, (relCount.get(r.targetEntityId) ?? 0) + 1);
      }
      return entities.map((e) => ({ ...e, relationCount: relCount.get(e.id) ?? 0 }));
    }),

    relations: publicProcedure.query(async () => {
      return getAllGraphRelations(2000);
    }),

    contradictions: publicProcedure.query(async () => {
      return getContradictionRelations(100);
    }),

    query: publicProcedure
      .input(z.object({ question: z.string().min(3).max(500) }))
      .mutation(async ({ input }) => {
        // Step 1: Fetch graph context
        const [entities, relations, contradictions] = await Promise.all([
          getAllGraphEntities(200),
          getAllGraphRelations(500),
          getContradictionRelations(50),
        ]);

        const entityIndex = entities
          .map((e) => `[${e.id}] ${e.entityType}: ${e.canonicalName}`)
          .join("\n");

        const relationIndex = relations
          .slice(0, 200)
          .map((r) => {
            const src = entities.find((e) => e.id === r.sourceEntityId);
            const tgt = entities.find((e) => e.id === r.targetEntityId);
            return `${src?.canonicalName ?? r.sourceEntityId} --[${r.relationType}]--> ${tgt?.canonicalName ?? r.targetEntityId}`;
          })
          .join("\n");

        const contradictionIndex = contradictions
          .slice(0, 20)
          .map((r) => {
            const src = entities.find((e) => e.id === r.sourceEntityId);
            return `CONTRADICTION: ${src?.canonicalName ?? r.sourceEntityId} (confidence: ${r.confidenceScore ?? "?"})` ;
          })
          .join("\n");

        const systemPrompt = `You are the Truth Desk knowledge graph assistant. You answer questions about scientific claims, proteins, PDB structures, and experimental methods using the graph context below.

Graph entities (${entities.length} total):
${entityIndex.slice(0, 3000)}

Graph relations (${relations.length} total):
${relationIndex.slice(0, 2000)}

${contradictionIndex ? `Known contradictions:\n${contradictionIndex}` : ""}

Answer the user's question concisely. Cite entity IDs like [42] when referencing specific entities. If you find contradictions relevant to the question, highlight them.`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input.question },
          ],
        });

        const answer = response?.choices?.[0]?.message?.content ?? "No answer available.";
        return {
          answer: typeof answer === "string" ? answer : JSON.stringify(answer),
          entityCount: entities.length,
          relationCount: relations.length,
          contradictionCount: contradictions.length,
        };
      }),
  }),

  // ─── Wiki ──────────────────────────────────────────────────────────────────
  wiki: router({
    getPage: publicProcedure
      .input(z.object({ entityType: z.string(), canonicalName: z.string() }))
      .query(async ({ input }) => {
        const { wikiKey } = await import("./wikiCompiler");
        const s3Key = wikiKey(input.entityType, input.canonicalName);
        const content = await fetchWikiPage(s3Key).catch(() => "");
        return { content, s3Key };
      }),
  }),
  // ─── Verticals ────────────────────────────────────────────────────────────
  verticals: router({
    stats: publicProcedure.query(async () => {
      return getVerticalStats();
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
    backfillWiki: protectedProcedure
      .mutation(async ({ ctx }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Owner or admin access required" });
        }
        const origin = process.env.VITE_APP_URL ?? "https://protein-desk-5r5rzpyg.manus.space";
        const { runBackfillWiki } = await import("./backfillWikiRoute");
        // Fire-and-forget — return immediately so the HTTP connection doesn't time out
        runBackfillWiki(origin, (msg) => {
          console.log(`[BackfillWiki/tRPC] ${msg}`);
        }).catch(console.error);
        return {
          status: "started" as const,
          message: "Backfill running in background. Check server logs or Telegram for progress.",
        };
      }),

    /**
     * Returns how many completed documents have been wiki-compiled vs. pending.
     */
    backfillStatus: protectedProcedure
      .query(async ({ ctx }) => {
        const { ENV } = await import("./_core/env");
        if (ctx.user.role !== "admin" && ctx.user.openId !== ENV.ownerOpenId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { getAllCompletedDocuments } = await import("./db");
        const allCompleted = await getAllCompletedDocuments(2000);
        const compiled = allCompleted.filter((d) => !!d.wikiCompiledAt).length;
        const pending = allCompleted.length - compiled;
        return {
          completedDocuments: allCompleted.length,
          wikiCompiled: compiled,
          wikiPending: pending,
          percentComplete:
            allCompleted.length > 0 ? Math.round((compiled / allCompleted.length) * 100) : 0,
        };
      }),
  }),

  // ─── Checkout (PayPal) ───────────────────────────────────────────────────────
  checkout: router({
    plans: publicProcedure.query(() => {
      return Object.entries(PLANS).map(([tier, plan]) => ({
        tier,
        label: plan.label,
        amountUsd: plan.amountUsd,
        auditsLimit: plan.auditsLimit,
        description: plan.description,
      }));
    }),
    createOrder: protectedProcedure
      .input(
        z.object({
          planTier: z.enum(["starter", "diligence", "platform"]),
          returnUrl: z.string().url(),
          cancelUrl: z.string().url(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await createPayPalOrder(
          input.planTier as PlanTier,
          ctx.user.id,
          input.returnUrl,
          input.cancelUrl
        );
        return result;
      }),
    captureOrder: protectedProcedure
      .input(z.object({ orderId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const sub = await capturePayPalOrder(input.orderId, ctx.user.id);
        return {
          success: true,
          planTier: sub.planTier,
          auditsLimit: sub.auditsLimit,
          activatedAt: sub.activatedAt,
        };
      }),
    getSubscription: protectedProcedure.query(async ({ ctx }) => {
      const sub = await getActiveSubscription(ctx.user.id);
      if (!sub) return null;
      return {
        planTier: sub.planTier,
        auditsLimit: sub.auditsLimit,
        auditsUsed: sub.auditsUsed,
        remaining: sub.auditsLimit === -1 ? -1 : sub.auditsLimit - sub.auditsUsed,
        activatedAt: sub.activatedAt,
        expiresAt: sub.expiresAt,
      };
    }),
    auditLimit: protectedProcedure.query(async ({ ctx }) => {
      return checkPayPalAuditLimit(ctx.user.id);
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
          return stored[0].prediction as Awaited<ReturnType<typeof computeClaimTrajectory>>;
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
      .input(z.object({
        predictionId: z.number(),
        result: z.enum(["correct", "incorrect"]),
      }))
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
      .input(z.object({
        url: z.string().url("Must be a valid URL"),
        label: z.string().max(128).optional(),
        eventTypes: z.array(z.string()).default(["high_risk_claim"]),
      }))
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
});

export type AppRouter = typeof appRouter;
