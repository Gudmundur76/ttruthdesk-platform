/**
 * CooccurrenceGraph.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Entity co-occurrence graph page.
 *
 * Route: /cooccurrence
 *
 * Displays a force-directed graph of entity pairs that co-occur in the same
 * document. Node size = degree (number of co-occurring partners).
 * Edge thickness = co-occurrence count.
 *
 * Uses a pure SVG/CSS simulation (no heavy D3 dependency) for simplicity.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, Info } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: number;
  name: string;
  entityType: string;
  degree: number;
  // simulation state
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphLink {
  source: number;
  target: number;
  value: number;
  documentId: number;
}

// ─── Entity type colors ───────────────────────────────────────────────────────

const ENTITY_COLORS: Record<string, string> = {
  protein: "#a78bfa",
  pdb_id: "#60a5fa",
  method: "#34d399",
  organism: "#fbbf24",
  ligand: "#f87171",
  author: "#fb923c",
  concept: "#e879f9",
  document: "#94a3b8",
};

function entityColor(type: string): string {
  return ENTITY_COLORS[type] ?? "#94a3b8";
}

// ─── Simple force simulation (no D3) ─────────────────────────────────────────

function runForceSimulation(
  nodes: GraphNode[],
  links: GraphLink[],
  width: number,
  height: number,
  iterations = 200
): GraphNode[] {
  const nodeMap = new Map<number, GraphNode>(nodes.map((n) => [n.id, { ...n }]));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;

    // Repulsion between all node pairs
    const nodeArr = Array.from(nodeMap.values());
    for (let i = 0; i < nodeArr.length; i++) {
      for (let j = i + 1; j < nodeArr.length; j++) {
        const a = nodeArr[i];
        const b = nodeArr[j];
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (3000 / (dist * dist)) * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction along links
    for (const link of links) {
      const a = nodeMap.get(link.source);
      const b = nodeMap.get(link.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = 120;
      const force = ((dist - targetDist) / dist) * 0.1 * alpha;
      const fx = dx * force;
      const fy = dy * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity
    for (const node of Array.from(nodeMap.values())) {
      node.vx += (width / 2 - node.x) * 0.005 * alpha;
      node.vy += (height / 2 - node.y) * 0.005 * alpha;
    }

    // Apply velocity + damping
    for (const node of Array.from(nodeMap.values())) {
      node.x += node.vx;
      node.y += node.vy;
      node.vx *= 0.7;
      node.vy *= 0.7;
      // Clamp to canvas
      node.x = Math.max(30, Math.min(width - 30, node.x));
      node.y = Math.max(30, Math.min(height - 30, node.y));
    }
  }

  return Array.from(nodeMap.values());
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CooccurrenceGraph() {
  const [limit, setLimit] = useState(80);
  const [filterType, setFilterType] = useState("all");
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [simulatedNodes, setSimulatedNodes] = useState<GraphNode[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const WIDTH = 900;
  const HEIGHT = 600;

  const { data, isLoading, error } = trpc.cooccurrence.top.useQuery(
    { limit },
    { staleTime: 60_000 }
  );

  // Run simulation when data changes
  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setSimulatedNodes([]);
      return;
    }

    // Initialise node positions randomly
    const initialNodes: GraphNode[] = data.nodes.map((n) => ({
      ...n,
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      vx: 0,
      vy: 0,
    }));

    const result = runForceSimulation(initialNodes, data.links, WIDTH, HEIGHT, 300);
    setSimulatedNodes(result);
  }, [data]);

  if (error) {
    toast.error("Failed to load co-occurrence data");
  }

  // Filter nodes by entity type
  const visibleNodeIds = new Set(
    simulatedNodes
      .filter((n) => filterType === "all" || n.entityType === filterType)
      .map((n) => n.id)
  );

  const visibleNodes = simulatedNodes.filter((n) => visibleNodeIds.has(n.id));
  const visibleLinks = (data?.links ?? []).filter(
    (l) => visibleNodeIds.has(l.source) && visibleNodeIds.has(l.target)
  );

  const nodeMap = new Map(simulatedNodes.map((n) => [n.id, n]));
  const maxCoCount = Math.max(...(data?.links.map((l) => l.value) ?? [1]), 1);
  const maxDegree = Math.max(...(data?.nodes.map((n) => n.degree) ?? [1]), 1);

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
              <Network className="w-6 h-6 text-violet-400" />
              Entity Co-occurrence Graph
            </h1>
            <p className="text-slate-400 text-sm">
              Entities that appear together in the same document. Node size = degree.
              Edge thickness = co-occurrence frequency.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Filter by type */}
            <div className="space-y-1">
              <Label className="text-slate-400 text-xs">Entity Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200 h-8 text-xs w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {Object.keys(ENTITY_COLORS).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Limit */}
            <div className="space-y-1">
              <Label className="text-slate-400 text-xs">Max Pairs</Label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200 h-8 text-xs w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="40">40</SelectItem>
                  <SelectItem value="80">80</SelectItem>
                  <SelectItem value="150">150</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Stats */}
        {data && (
          <div className="flex gap-4 text-xs text-slate-400">
            <span><span className="text-white font-medium">{data.nodes.length}</span> entities</span>
            <span><span className="text-white font-medium">{data.links.length}</span> co-occurrence pairs</span>
            {hoveredNode && (
              <span className="text-violet-300">
                Hovering: <strong>{hoveredNode.name}</strong> ({hoveredNode.entityType}) — degree {hoveredNode.degree}
              </span>
            )}
          </div>
        )}

        {/* Graph canvas */}
        <Card className="bg-slate-900/60 border-slate-700 overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-[600px]">
                <div className="text-center space-y-3">
                  <Skeleton className="w-64 h-4 mx-auto bg-slate-700" />
                  <Skeleton className="w-48 h-4 mx-auto bg-slate-700" />
                  <p className="text-slate-500 text-sm mt-4">Computing co-occurrence graph…</p>
                </div>
              </div>
            ) : data && data.nodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[600px] text-slate-500">
                <Network className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">No co-occurrence data yet.</p>
                <p className="text-xs mt-1">Submit documents to populate the knowledge graph.</p>
              </div>
            ) : (
              <svg
                ref={svgRef}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="w-full h-[600px] bg-slate-950"
                style={{ cursor: "default" }}
              >
                {/* Links */}
                {visibleLinks.map((link, i) => {
                  const src = nodeMap.get(link.source);
                  const tgt = nodeMap.get(link.target);
                  if (!src || !tgt) return null;
                  const thickness = 1 + (link.value / maxCoCount) * 4;
                  const opacity = 0.2 + (link.value / maxCoCount) * 0.5;
                  return (
                    <line
                      key={i}
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke="#6366f1"
                      strokeWidth={thickness}
                      strokeOpacity={opacity}
                    />
                  );
                })}

                {/* Nodes */}
                {visibleNodes.map((node) => {
                  const r = 6 + (node.degree / maxDegree) * 18;
                  const color = entityColor(node.entityType);
                  const isHovered = hoveredNode?.id === node.id;
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHoveredNode(node)}
                      onMouseLeave={() => setHoveredNode(null)}
                    >
                      <circle
                        r={isHovered ? r + 3 : r}
                        fill={color}
                        fillOpacity={isHovered ? 1 : 0.8}
                        stroke={isHovered ? "#fff" : color}
                        strokeWidth={isHovered ? 2 : 0.5}
                        style={{ transition: "r 150ms ease-out, fill-opacity 150ms" }}
                      />
                      {(r > 10 || isHovered) && (
                        <text
                          textAnchor="middle"
                          dy={r + 12}
                          fontSize={isHovered ? 11 : 9}
                          fill="#e2e8f0"
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {node.name.length > 16 ? node.name.slice(0, 14) + "…" : node.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {Object.entries(ENTITY_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5 text-xs text-slate-400">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              {type}
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
