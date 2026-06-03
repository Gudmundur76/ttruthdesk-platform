/**
 * WikiPage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a single entity wiki page from S3.
 * Route: /wiki/:entityType/:entitySlug
 *
 * Shows:
 *   - Markdown wiki content compiled by wikiCompiler
 *   - Contradiction alert if any contradicts edges exist for this entity
 *   - Related entities list
 *   - Link back to the knowledge graph
 */

import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useMemo, useEffect } from "react";
import { Streamdown } from "streamdown";
import { TopNav } from "@/components/TopNav";

const ENTITY_TYPE_LABEL: Record<string, string> = {
  protein: "Protein",
  pdb_id: "PDB Structure",
  method: "Method",
  organism: "Organism",
  ligand: "Ligand",
  author: "Author",
  concept: "Concept",
  document: "Document",
};

export default function WikiPage() {
  const params = useParams<{ entityType: string; entitySlug: string }>();
  const [, navigate] = useLocation();

  // Decode slug back to canonical name
  const canonicalName = decodeURIComponent(params.entitySlug ?? "").replace(/_/g, " ");
  const entityType = params.entityType ?? "pdb_id";

  const { data, isLoading, isError } = trpc.wiki.getPage.useQuery(
    { entityType, canonicalName },
    { enabled: !!canonicalName }
  );

  const { data: entities } = trpc.graph.entities.useQuery();
  const { data: relations } = trpc.graph.relations.useQuery();
  const { data: contradictions } = trpc.graph.contradictions.useQuery();

  // Find this entity in the graph
  const thisEntity = useMemo(
    () =>
      entities?.find(
        (e) =>
          e.entityType === entityType &&
          e.canonicalName.toLowerCase() === canonicalName.toLowerCase()
      ),
    [entities, entityType, canonicalName]
  );

  // Find related entities
  const relatedEntities = useMemo(() => {
    if (!thisEntity || !relations || !entities) return [];
    const related: Array<{ entity: (typeof entities)[0]; relationType: string }> = [];
    for (const r of relations) {
      if (r.sourceEntityId === thisEntity.id) {
        const tgt = entities.find((e) => e.id === r.targetEntityId);
        if (tgt && tgt.id !== thisEntity.id) {
          related.push({ entity: tgt, relationType: r.relationType });
        }
      }
      if (r.targetEntityId === thisEntity.id) {
        const src = entities.find((e) => e.id === r.sourceEntityId);
        if (src && src.id !== thisEntity.id) {
          related.push({ entity: src, relationType: r.relationType });
        }
      }
    }
    // Deduplicate
    const seen = new Set<number>();
    return related.filter(({ entity }) => {
      if (seen.has(entity.id)) return false;
      seen.add(entity.id);
      return true;
    });
  }, [thisEntity, relations, entities]);

  const typeLabel = ENTITY_TYPE_LABEL[entityType] ?? entityType;

  // Inject JSON-LD Dataset schema and update page title
  useEffect(() => {
    if (!canonicalName) return;

    // Update page title
    document.title = `${canonicalName} — Truth Desk Knowledge Graph`;

    // Inject JSON-LD Dataset schema
    const existingScript = document.getElementById("wiki-jsonld");
    if (existingScript) existingScript.remove();

    const script = document.createElement("script");
    script.id = "wiki-jsonld";
    script.type = "application/ld+json";
    const jsonld: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `Truth Desk Verification: ${typeLabel} ${canonicalName}`,
      description: `Autonomous evidence audit of claims about ${typeLabel} ${canonicalName}. Verified against RCSB PDB, PubChem, and domain-specific sources.`,
      url: window.location.href,
      dateModified: new Date().toISOString(),
      creator: {
        "@type": "Organization",
        name: "Truth Desk",
        url: window.location.origin,
      },
      license: "https://creativecommons.org/licenses/by/4.0/",
      keywords: [canonicalName, entityType, "protein verification", "scientific claims", "PDB"],
    };
    if (entityType === "pdb_id") {
      jsonld.identifier = `PDB:${canonicalName}`;
      jsonld.citation = [{
        "@type": "ScholarlyArticle",
        headline: `PDB entry ${canonicalName}`,
        identifier: `PDB:${canonicalName}`,
        url: `https://www.rcsb.org/structure/${canonicalName}`,
      }];
    }
    script.textContent = JSON.stringify(jsonld);
    document.head.appendChild(script);

    return () => {
      const s = document.getElementById("wiki-jsonld");
      if (s) s.remove();
      document.title = "Truth Desk";
    };
  }, [canonicalName, entityType, typeLabel]);

  // Check for contradictions involving this entity
  const hasContradictions = useMemo(() => {
    if (!thisEntity || !contradictions) return false;
    return contradictions.some(
      (c) =>
        c.sourceEntityId === thisEntity.id || c.targetEntityId === thisEntity.id
    );
  }, [thisEntity, contradictions]);

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <TopNav />

      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-6">
          <button onClick={() => navigate("/graph")} className="hover:text-slate-300 transition-colors">
            Knowledge Graph
          </button>
          <span>/</span>
          <span className="text-slate-400">{typeLabel}</span>
          <span>/</span>
          <span className="text-white">{canonicalName}</span>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {typeLabel}
            </span>
            {hasContradictions && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                Contradictions detected
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white">{canonicalName}</h1>
        </div>

        {/* Contradiction alert */}
        {hasContradictions && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <p className="text-sm text-red-300 font-medium mb-1">Cross-document contradictions detected</p>
            <p className="text-xs text-red-400/80 leading-relaxed">
              The wiki linter has identified conflicting claims about this entity across multiple documents.
              Review the "Contradictions Detected" section in the wiki page below.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Wiki content */}
          <div className="lg:col-span-2">
            <div className="bg-[#0f1525]/80 border border-white/10 rounded-2xl p-6">
              {isLoading && (
                <div className="flex items-center gap-3 text-slate-400 text-sm">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Loading wiki page…
                </div>
              )}
              {isError && (
                <p className="text-red-400 text-sm">Failed to load wiki page.</p>
              )}
              {!isLoading && !isError && (!data?.content || data.content.trim().length === 0) && (
                <div className="text-center py-8 space-y-3">
                  <p className="text-slate-400 text-sm">No wiki page yet for this entity.</p>
                  <p className="text-slate-500 text-xs">
                    Wiki pages are automatically compiled when documents containing this entity are audited.
                  </p>
                </div>
              )}
              {data?.content && data.content.trim().length > 0 && (
                <div className="prose prose-sm prose-invert max-w-none
                  prose-headings:text-white prose-headings:font-semibold
                  prose-p:text-slate-300 prose-p:leading-relaxed
                  prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                  prose-code:text-green-300 prose-code:bg-white/5 prose-code:px-1 prose-code:rounded
                  prose-pre:bg-white/5 prose-pre:border prose-pre:border-white/10
                  prose-table:text-slate-300 prose-th:text-slate-200 prose-th:border-white/20
                  prose-td:border-white/10 prose-strong:text-white
                  prose-blockquote:border-blue-500 prose-blockquote:text-slate-400">
                  <Streamdown>{data.content}</Streamdown>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar: related entities */}
          <div className="space-y-4">
            <div className="bg-[#0f1525]/80 border border-white/10 rounded-2xl p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Related Entities
              </h3>
              {relatedEntities.length === 0 ? (
                <p className="text-xs text-slate-500">No relations yet.</p>
              ) : (
                <ul className="space-y-2">
                  {relatedEntities.slice(0, 15).map(({ entity, relationType }) => (
                    <li key={entity.id}>
                      <button
                        onClick={() =>
                          navigate(
                            `/wiki/${entity.entityType}/${encodeURIComponent(entity.canonicalName.replace(/ /g, "_"))}`
                          )
                        }
                        className="w-full text-left group"
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-500 flex-shrink-0">
                            {ENTITY_TYPE_LABEL[entity.entityType]?.slice(0, 4) ?? entity.entityType.slice(0, 4)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs text-slate-300 group-hover:text-white transition-colors truncate">
                              {entity.canonicalName}
                            </p>
                            <p className="text-[10px] text-slate-600">{relationType.replace(/_/g, " ")}</p>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Graph link */}
            <button
              onClick={() => navigate("/graph")}
              className="w-full text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-xl py-3 transition-colors bg-white/5 hover:bg-white/10"
            >
              ← Back to Knowledge Graph
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
