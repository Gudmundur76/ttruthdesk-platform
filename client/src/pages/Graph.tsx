import { useRef, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { trpc } from "@/lib/trpc";

// ─── Colour helpers ──────────────────────────────────────────────────────────

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

function verdictColor(verdict: string | null): string {
  if (!verdict) return "#94a3b8";
  return VERDICT_COLOR[verdict] ?? "#94a3b8";
}

function domainColor(domain: string | null): string {
  if (!domain) return DOMAIN_COLOR.unknown;
  return DOMAIN_COLOR[domain] ?? DOMAIN_COLOR.unknown;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  type: "document" | "pdb";
  color: string;
  size: number;
  meta?: Record<string, unknown>;
}

interface GraphLink {
  source: string;
  target: string;
  color: string;
  label?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Graph() {
  const { data, isLoading, isError } = trpc.graph.data.useQuery();
  const fgRef = useRef<{ centerAt: (x: number, y: number, ms: number) => void; zoom: (k: number, ms: number) => void } | null>(null);

  const { nodes, links } = useMemo(() => {
    if (!data) return { nodes: [], links: [] };

    const nodeMap = new Map<string, GraphNode>();
    const linkList: GraphLink[] = [];

    // Document nodes
    for (const doc of data.documents) {
      const nodeId = `doc-${doc.id}`;
      nodeMap.set(nodeId, {
        id: nodeId,
        label: doc.title ? (doc.title.length > 40 ? doc.title.slice(0, 40) + "…" : doc.title) : `Doc #${doc.id}`,
        type: "document",
        color: domainColor(doc.verticalDomain ?? null),
        size: 6,
        meta: { id: doc.id, domain: doc.verticalDomain, status: doc.status },
      });
    }

    // Claim → PDB edges and PDB nodes
    for (const claim of data.claims) {
      const docNodeId = `doc-${claim.documentId}`;
      if (!nodeMap.has(docNodeId)) continue; // orphaned claim — skip

      if (claim.pdbId) {
        const pdbNodeId = `pdb-${claim.pdbId}`;
        if (!nodeMap.has(pdbNodeId)) {
          nodeMap.set(pdbNodeId, {
            id: pdbNodeId,
            label: claim.pdbId,
            type: "pdb",
            color: verdictColor(claim.verdict ?? null),
            size: 4,
            meta: { pdbId: claim.pdbId },
          });
        }
        linkList.push({
          source: docNodeId,
          target: pdbNodeId,
          color: verdictColor(claim.verdict ?? null) + "99",
          label: claim.claimType ?? undefined,
        });
      }
    }

    return { nodes: Array.from(nodeMap.values()), links: linkList };
  }, [data]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.type === "document" && node.meta?.id) {
        window.open(`/reports/${node.meta.id}`, "_blank");
      } else if (node.type === "pdb" && node.meta?.pdbId) {
        window.open(`https://www.rcsb.org/structure/${node.meta.pdbId}`, "_blank");
      }
    },
    []
  );

  const handleZoomToFit = useCallback(() => {
    if (fgRef.current) {
      fgRef.current.centerAt(0, 0, 600);
      fgRef.current.zoom(1, 600);
    }
  }, []);

  // ─── Render states ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Loading knowledge graph…</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-destructive">Failed to load graph data. Please refresh.</p>
      </div>
    );
  }

  if (!data || nodes.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3 max-w-md px-6">
          <p className="text-2xl font-semibold text-foreground">No data yet</p>
          <p className="text-muted-foreground text-sm">
            The knowledge graph will populate once documents have been analysed and claims verified. Submit a paper to get started.
          </p>
        </div>
      </div>
    );
  }

  const docCount = nodes.filter((n) => n.type === "document").length;
  const pdbCount = nodes.filter((n) => n.type === "pdb").length;

  return (
    <div className="relative w-full h-screen bg-[#0a0e1a] overflow-hidden">
      {/* Header overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-[#0a0e1a] to-transparent pointer-events-none">
        <div>
          <h1 className="text-white text-xl font-semibold tracking-tight">Knowledge Graph</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            {docCount} document{docCount !== 1 ? "s" : ""} · {pdbCount} PDB structure{pdbCount !== 1 ? "s" : ""} · {links.length} claim link{links.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={handleZoomToFit}
          className="pointer-events-auto text-xs text-slate-300 bg-white/10 hover:bg-white/20 transition-colors px-3 py-1.5 rounded-md backdrop-blur-sm"
        >
          Reset view
        </button>
      </div>

      {/* Legend overlay */}
      <div className="absolute bottom-6 left-6 z-10 bg-[#0a0e1a]/80 backdrop-blur-sm rounded-xl border border-white/10 p-4 text-xs text-slate-300 space-y-3">
        <div>
          <p className="text-slate-400 uppercase tracking-wider text-[10px] mb-1.5">Document domain</p>
          <div className="space-y-1">
            {Object.entries(DOMAIN_COLOR).map(([key, color]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span>{key.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-slate-400 uppercase tracking-wider text-[10px] mb-1.5">PDB node / link verdict</p>
          <div className="space-y-1">
            {Object.entries(VERDICT_COLOR).map(([key, color]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span>{key}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-slate-500 text-[10px] pt-1 border-t border-white/10">Click a node to open its page</p>
      </div>

      {/* Force graph */}
      <ForceGraph2D
        ref={fgRef as never}
        graphData={{ nodes: nodes as never, links: links as never }}
        nodeId="id"
        nodeLabel="label"
        nodeColor={(n) => (n as GraphNode).color}
        nodeVal={(n) => (n as GraphNode).size}
        linkColor={(l) => (l as GraphLink).color}
        linkWidth={1}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        backgroundColor="#0a0e1a"
        onNodeClick={(n) => handleNodeClick(n as GraphNode)}
        nodeCanvasObjectMode={() => "after"}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as GraphNode & { x?: number; y?: number };
          if (!n.x || !n.y) return;
          const label = n.label;
          const fontSize = Math.max(8, 12 / globalScale);
          if (globalScale < 1.5) return; // only render labels when zoomed in
          ctx.font = `${fontSize}px Inter, sans-serif`;
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(label, n.x, n.y + (n.size ?? 4) + 2);
        }}
        cooldownTicks={120}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}
