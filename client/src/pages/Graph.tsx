import { useRef, useCallback, useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { GraphQueryBox } from "@/components/GraphQueryBox";
import CorpusGrowthWidget from "@/components/CorpusGrowthWidget";

// ─── Colour maps ─────────────────────────────────────────────────────────────

const VERDICT_COLOR: Record<string, string> = {
  Supported: "#22c55e",
  Contradicted: "#ef4444",
  Ambiguous: "#f59e0b",
  "Partially Supported": "#84cc16",
  "Partially Contradicted": "#f97316",
  "Out of Scope": "#94a3b8",
  "Insufficient Evidence": "#a78bfa",
};

const DOMAIN_COLOR: Record<string, string> = {
  structural_biology: "#3b82f6",
  salmon_biotech: "#10b981",
  unknown: "#64748b",
};

function verdictColor(v: string | null) {
  if (!v) return "#94a3b8";
  return VERDICT_COLOR[v] ?? "#94a3b8";
}
function domainColor(d: string | null) {
  if (!d) return DOMAIN_COLOR.unknown;
  return DOMAIN_COLOR[d] ?? DOMAIN_COLOR.unknown;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GNode {
  id: string;
  label: string;
  type: "document" | "pdb";
  color: string;
  size: number;
  domain?: string | null;
  verdict?: string | null;
  createdAt?: Date | string | null;
  meta?: Record<string, unknown>;
}
interface GLink {
  source: string;
  target: string;
  color: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useEmbedMode() {
  // detect ?embed=1 in the URL
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed") === "1";
}

const EMBED_SNIPPET = (origin: string) =>
  `<iframe src="${origin}/graph?embed=1" width="100%" height="520" style="border:none;border-radius:12px;" title="Truth Desk Knowledge Graph" loading="lazy"></iframe>`;

// ─── Component ────────────────────────────────────────────────────────────────

const ENTITY_TYPE_COLOR: Record<string, string> = {
  protein: "#a78bfa",
  pdb_id: "#38bdf8",
  method: "#fb923c",
  organism: "#4ade80",
  ligand: "#f472b6",
  author: "#facc15",
  concept: "#94a3b8",
  document: "#3b82f6",
};

export default function Graph() {
  const { data, isLoading, isError } = trpc.graph.data.useQuery();
  const { data: entityData } = trpc.graph.entities.useQuery();
  const { data: relationData } = trpc.graph.relations.useQuery();
  const { data: contradictionData } = trpc.graph.contradictions.useQuery();
  const fgRef = useRef<{ centerAt: (x: number, y: number, ms: number) => void; zoom: (k: number, ms: number) => void } | null>(null);
  const isEmbed = useEmbedMode();
  const [, navigate] = useLocation();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [verdictFilter, setVerdictFilter] = useState<string>("all");
  const [sidebarOpen, setSidebarOpen] = useState(!isEmbed);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [showQueryBox, setShowQueryBox] = useState(false);

  // ── Build graph data ────────────────────────────────────────────────────────
  const { nodes, links } = useMemo(() => {
    if (!data) return { nodes: [], links: [] };

    const nodeMap = new Map<string, GNode>();
    const linkList: GLink[] = [];

    for (const doc of data.documents) {
      const nid = `doc-${doc.id}`;
      nodeMap.set(nid, {
        id: nid,
        label: doc.title ? (doc.title.length > 45 ? doc.title.slice(0, 45) + "…" : doc.title) : `Doc #${doc.id}`,
        type: "document",
        color: domainColor(doc.verticalDomain ?? null),
        size: 6,
        domain: doc.verticalDomain,
        createdAt: doc.createdAt,
        meta: { id: doc.id, domain: doc.verticalDomain, status: doc.status },
      });
    }

    for (const claim of data.claims) {
      const docNid = `doc-${claim.documentId}`;
      if (!nodeMap.has(docNid)) continue;
      if (claim.pdbId) {
        const pdbNid = `pdb-${claim.pdbId}`;
        if (!nodeMap.has(pdbNid)) {
          nodeMap.set(pdbNid, {
            id: pdbNid,
            label: claim.pdbId,
            type: "pdb",
            color: verdictColor(claim.verdict ?? null),
            size: 4,
            verdict: claim.verdict,
            meta: { pdbId: claim.pdbId },
          });
        }
        linkList.push({
          source: docNid,
          target: pdbNid,
          color: verdictColor(claim.verdict ?? null) + "88",
        });
      }
    }

    // Overlay knowledge graph entities (from graph_entities table)
    if (entityData) {
      const contradictIds = new Set<number>();
      if (contradictionData) {
        for (const c of contradictionData) {
          contradictIds.add(c.sourceEntityId);
          contradictIds.add(c.targetEntityId);
        }
      }
      for (const entity of entityData) {
        if (entity.entityType === "document") continue; // already added above
        const nid = `entity-${entity.id}`;
        if (!nodeMap.has(nid)) {
          nodeMap.set(nid, {
            id: nid,
            label: entity.canonicalName.length > 30 ? entity.canonicalName.slice(0, 30) + "…" : entity.canonicalName,
            type: "pdb" as const,
            color: contradictIds.has(entity.id)
              ? "#ef4444"
              : (ENTITY_TYPE_COLOR[entity.entityType] ?? "#94a3b8"),
            size: contradictIds.has(entity.id) ? 7 : 4,
            meta: { entityId: entity.id, entityType: entity.entityType, canonicalName: entity.canonicalName },
          });
        }
      }
      // Add typed relation links
      if (relationData) {
        for (const rel of relationData) {
          const srcNid = `entity-${rel.sourceEntityId}`;
          const tgtNid = `entity-${rel.targetEntityId}`;
          if (nodeMap.has(srcNid) && nodeMap.has(tgtNid) && srcNid !== tgtNid) {
            const isContradiction = rel.relationType === "contradicts";
            linkList.push({
              source: srcNid,
              target: tgtNid,
              color: isContradiction ? "#ef444488" : "#38bdf844",
            });
          }
        }
      }
    }

    return { nodes: Array.from(nodeMap.values()), links: linkList };
  }, [data, entityData, relationData, contradictionData]);

  // ── Apply filters ───────────────────────────────────────────────────────────
  const { filteredNodes, filteredLinks } = useMemo(() => {
    const q = search.toLowerCase().trim();

    const visibleNodeIds = new Set<string>();
    for (const n of nodes) {
      if (domainFilter !== "all" && n.type === "document" && n.domain !== domainFilter) continue;
      if (verdictFilter !== "all" && n.type === "pdb" && n.verdict !== verdictFilter) continue;
      if (q && !n.label.toLowerCase().includes(q)) continue;
      visibleNodeIds.add(n.id);
    }

    // also keep PDB nodes connected to visible doc nodes
    const extraPdb = new Set<string>();
    for (const l of links) {
      const src = typeof l.source === "string" ? l.source : (l.source as GNode).id;
      const tgt = typeof l.target === "string" ? l.target : (l.target as GNode).id;
      if (visibleNodeIds.has(src)) extraPdb.add(tgt);
      if (visibleNodeIds.has(tgt)) extraPdb.add(src);
    }
    extraPdb.forEach((id) => visibleNodeIds.add(id));

    const fn = nodes.filter((n) => visibleNodeIds.has(n.id));
    const fl = links.filter((l) => {
      const src = typeof l.source === "string" ? l.source : (l.source as GNode).id;
      const tgt = typeof l.target === "string" ? l.target : (l.target as GNode).id;
      return visibleNodeIds.has(src) && visibleNodeIds.has(tgt);
    });
    return { filteredNodes: fn, filteredLinks: fl };
  }, [nodes, links, search, domainFilter, verdictFilter]);

  const handleNodeClick = useCallback((node: GNode) => {
    if (node.type === "document" && node.meta?.id) {
      navigate(`/reports/${node.meta.id}`);
    } else if (node.meta?.entityId && node.meta?.entityType && node.meta?.canonicalName) {
      // Knowledge graph entity node → wiki page
      const slug = encodeURIComponent(String(node.meta.canonicalName).replace(/ /g, "_"));
      navigate(`/wiki/${node.meta.entityType}/${slug}`);
    } else if (node.type === "pdb" && node.meta?.pdbId) {
      window.open(`https://www.rcsb.org/structure/${node.meta.pdbId}`, "_blank");
    }
  }, [navigate]);

  const handleZoomToFit = useCallback(() => {
    if (fgRef.current) {
      fgRef.current.centerAt(0, 0, 600);
      fgRef.current.zoom(1, 600);
    }
  }, []);

  const handleCopyEmbed = useCallback(() => {
    navigator.clipboard.writeText(EMBED_SNIPPET(window.location.origin)).then(() => {
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
    });
  }, []);

  // ── Loading / error / empty ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">Loading knowledge graph…</p>
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <p className="text-red-400">Failed to load graph data. Please refresh.</p>
      </div>
    );
  }
  if (!data || nodes.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center space-y-3 max-w-md px-6">
          <p className="text-2xl font-semibold text-white">No data yet</p>
          <p className="text-slate-400 text-sm">Submit a paper to populate the knowledge graph.</p>
        </div>
      </div>
    );
  }

  const docCount = filteredNodes.filter((n) => n.type === "document").length;
  const pdbCount = filteredNodes.filter((n) => n.type === "pdb").length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-screen bg-[#0a0e1a] overflow-hidden flex">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      {!isEmbed && (
        <aside
          className={cn(
            "relative z-20 flex-shrink-0 flex flex-col bg-[#0f1525]/95 backdrop-blur-sm border-r border-white/10 transition-all duration-300 overflow-hidden",
            sidebarOpen ? "w-64" : "w-0"
          )}
        >
          <div className="p-4 space-y-5 overflow-y-auto flex-1 min-w-64">
            <div>
              <h2 className="text-white text-sm font-semibold mb-3">Knowledge Graph</h2>
              <p className="text-slate-400 text-xs leading-relaxed">
                {docCount} doc{docCount !== 1 ? "s" : ""} · {pdbCount} PDB structure{pdbCount !== 1 ? "s" : ""} · {filteredLinks.length} link{filteredLinks.length !== 1 ? "s" : ""}
              </p>
            </div>

            {/* Search */}
            <div>
              <label className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1.5">Search nodes</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by label…"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/60 transition-colors"
              />
            </div>

            {/* Domain filter */}
            <div>
              <label className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1.5">Vertical domain</label>
              <div className="space-y-1">
                {["all", "structural_biology", "salmon_biotech"].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDomainFilter(d)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-2",
                      domainFilter === d ? "bg-white/15 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                    )}
                  >
                    {d !== "all" && (
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: DOMAIN_COLOR[d] }} />
                    )}
                    {d === "all" ? "All domains" : d.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            {/* Verdict filter */}
            <div>
              <label className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1.5">PDB verdict</label>
              <div className="space-y-1">
                <button
                  onClick={() => setVerdictFilter("all")}
                  className={cn(
                    "w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors",
                    verdictFilter === "all" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  All verdicts
                </button>
                {Object.entries(VERDICT_COLOR).map(([v, c]) => (
                  <button
                    key={v}
                    onClick={() => setVerdictFilter(v)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-2",
                      verdictFilter === v ? "bg-white/15 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Reset */}
            {(search || domainFilter !== "all" || verdictFilter !== "all") && (
              <button
                onClick={() => { setSearch(""); setDomainFilter("all"); setVerdictFilter("all"); }}
                className="w-full text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg py-2 transition-colors"
              >
                Clear filters
              </button>
            )}

            {/* Entity type legend */}
            <div className="pt-2 border-t border-white/10">
              <label className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1.5">Entity types</label>
              <div className="space-y-1">
                {Object.entries(ENTITY_TYPE_COLOR).map(([type, color]) => (
                  <div key={type} className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    {type.replace(/_/g, " ")}
                  </div>
                ))}
                <div className="flex items-center gap-2 text-[10px] text-red-400">
                  <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-500" />
                  contradiction
                </div>
              </div>
            </div>

            {/* Contradiction list */}
            {contradictionData && contradictionData.length > 0 && (
              <div className="pt-2 border-t border-white/10">
                <label className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1.5">Active contradictions</label>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {contradictionData.slice(0, 8).map((c) => (
                    <a
                      key={c.id}
                      href={`/contradictions/${c.id}`}
                      className="flex items-center justify-between text-[10px] text-slate-400 hover:text-red-300 transition-colors py-0.5 group"
                    >
                      <span className="truncate max-w-[140px]">
                        #{c.sourceEntityId} ↔ #{c.targetEntityId}
                      </span>
                      <span className="text-red-500/60 group-hover:text-red-400 ml-1 flex-shrink-0 text-[10px]">view →</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Live Corpus Growth */}
            <div className="pt-2 border-t border-white/10">
              <label className="text-slate-400 text-[10px] uppercase tracking-wider block mb-2">Live corpus growth</label>
              <div className="[&_.rounded-xl]:rounded-lg [&_.text-2xl]:text-base [&_.text-xs]:text-[10px] [&_p.text-xs]:text-[9px] [&_.p-4]:p-2 [&_.gap-3]:gap-1.5 [&_.grid-cols-2]:grid-cols-2">
                <CorpusGrowthWidget />
              </div>
            </div>

            {/* Embed snippet */}
            <div className="pt-2 border-t border-white/10">
              <label className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1.5">Embed this graph</label>
              <p className="text-slate-500 text-[10px] mb-2 leading-relaxed">Copy the iframe snippet to embed on laxey.is or any website.</p>
              <button
                onClick={handleCopyEmbed}
                className="w-full text-xs bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded-lg py-2 transition-colors"
              >
                {embedCopied ? "✓ Copied!" : "Copy embed snippet"}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ── Toggle sidebar button ────────────────────────────────────────────── */}
      {!isEmbed && (
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="absolute top-4 left-4 z-30 w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
          style={{ left: sidebarOpen ? "256px" : "16px" }}
          title={sidebarOpen ? "Hide panel" : "Show panel"}
        >
          {sidebarOpen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
          )}
        </button>
      )}

      {/* ── Top-right controls ───────────────────────────────────────────────── */}
      {!isEmbed && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <button
            onClick={() => setShowQueryBox((v) => !v)}
            className={cn(
              "text-xs transition-colors px-3 py-1.5 rounded-md backdrop-blur-sm",
              showQueryBox
                ? "bg-blue-600/30 text-blue-300 border border-blue-500/40"
                : "text-slate-300 bg-white/10 hover:bg-white/20"
            )}
          >
            Ask Graph
          </button>
          <button
            onClick={handleZoomToFit}
            className="text-xs text-slate-300 bg-white/10 hover:bg-white/20 transition-colors px-3 py-1.5 rounded-md backdrop-blur-sm"
          >
            Reset view
          </button>
        </div>
      )}

      {/* ── Graph query overlay ─────────────────────────────────────────────── */}
      {!isEmbed && showQueryBox && (
        <div className="absolute top-14 right-4 z-30 w-[420px] max-w-[calc(100vw-2rem)]">
          <GraphQueryBox
            entityCount={entityData?.length ?? 0}
            relationCount={0}
            contradictionCount={contradictionData?.length ?? 0}
          />
        </div>
      )}

      {/* ── Embed watermark ──────────────────────────────────────────────────── */}
      {isEmbed && (
        <div className="absolute bottom-3 right-3 z-20 text-[10px] text-slate-500">
          <a href="/" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">
            Truth Desk
          </a>
        </div>
      )}

      {/* ── Force graph ─────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        <ForceGraph2D
          ref={fgRef as never}
          graphData={{ nodes: filteredNodes as never, links: filteredLinks as never }}
          nodeId="id"
          nodeLabel="label"
          nodeColor={(n) => (n as GNode).color}
          nodeVal={(n) => (n as GNode).size}
          linkColor={(l) => (l as GLink).color}
          linkWidth={1}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          backgroundColor="#0a0e1a"
          onNodeClick={(n) => handleNodeClick(n as GNode)}
          nodeCanvasObjectMode={() => "after"}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as GNode & { x?: number; y?: number };
            if (!n.x || !n.y || globalScale < 1.8) return;
            const fontSize = Math.max(8, 11 / globalScale);
            ctx.font = `${fontSize}px Inter, sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(n.label, n.x, n.y + (n.size ?? 4) + 2);
          }}
          cooldownTicks={120}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
        />
      </div>
    </div>
  );
}
