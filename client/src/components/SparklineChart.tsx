/**
 * SparklineChart.tsx — Phase 108
 *
 * A lightweight, zero-dependency SVG sparkline that renders a claim's
 * compositeTruthScore history over time.
 *
 * Features:
 *   - Pure SVG — no external charting library required
 *   - Colour-coded by the latest label (green = verified_faithful, red = contradicted, etc.)
 *   - Shows a tooltip with score + date on hover
 *   - Gracefully handles 0 or 1 data points (renders a flat line or empty state)
 *   - Accessible: role="img" with aria-label
 */

import React, { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScorePoint {
  compositeTruthScore: number;
  compositeTruthLabel?: string | null;
  snapshotAt: Date | string;
}

interface SparklineChartProps {
  /** Array of score snapshots, ordered oldest-first */
  data: ScorePoint[];
  /** SVG width in pixels (default 120) */
  width?: number;
  /** SVG height in pixels (default 36) */
  height?: number;
  /** Show axis labels (default false — keeps it compact for claim cards) */
  showLabels?: boolean;
  /** Additional CSS class names */
  className?: string;
}

// ─── Label → colour mapping ───────────────────────────────────────────────────

const LABEL_COLOURS: Record<string, string> = {
  verified_faithful: "#22c55e",    // green-500
  verified_distorted: "#f59e0b",   // amber-500
  contradicted: "#ef4444",         // red-500
  contradicted_amplified: "#dc2626", // red-600
  partially_supported: "#f97316",  // orange-500
  contested: "#a855f7",            // purple-500
  insufficient_evidence: "#6b7280", // gray-500
  out_of_scope: "#6b7280",         // gray-500
};

function getLabelColour(label?: string | null): string {
  if (!label) return "#6b7280";
  return LABEL_COLOURS[label] ?? "#6b7280";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SparklineChart({
  data,
  width = 120,
  height = 36,
  showLabels = false,
  className = "",
}: SparklineChartProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    score: number;
    date: string;
  } | null>(null);

  // ── Edge cases ───────────────────────────────────────────────────────────────

  if (data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="No score history available"
        className={className}
      >
        <line
          x1={4}
          y1={height / 2}
          x2={width - 4}
          y2={height / 2}
          stroke="#d1d5db"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  // ── Single point: render a dot ────────────────────────────────────────────────

  const latestLabel = data[data.length - 1]?.compositeTruthLabel;
  const colour = getLabelColour(latestLabel);

  if (data.length === 1) {
    const score = data[0].compositeTruthScore;
    const cy = height - 4 - (score * (height - 8));
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Score: ${score.toFixed(2)}`}
        className={className}
      >
        <circle cx={width / 2} cy={cy} r={3} fill={colour} />
      </svg>
    );
  }

  // ── Multi-point sparkline ─────────────────────────────────────────────────────

  const padX = 4;
  const padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const scores = data.map(d => d.compositeTruthScore);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const scoreRange = maxScore - minScore || 1; // avoid div-by-zero

  const toX = (i: number) => padX + (i / (data.length - 1)) * innerW;
  const toY = (score: number) =>
    padY + innerH - ((score - minScore) / scoreRange) * innerH;

  // Build SVG path
  const points = data.map((d, i) => ({
    x: toX(i),
    y: toY(d.compositeTruthScore),
    score: d.compositeTruthScore,
    date: new Date(d.snapshotAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  }));

  const linePath =
    points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");

  // Area fill path (close back to baseline)
  const areaPath =
    linePath +
    ` L ${points[points.length - 1].x.toFixed(1)} ${(height - padY).toFixed(1)}` +
    ` L ${points[0].x.toFixed(1)} ${(height - padY).toFixed(1)} Z`;

  const latestScore = scores[scores.length - 1];
  const ariaLabel = `Composite truth score history. Latest: ${latestScore.toFixed(2)} (${latestLabel ?? "unscored"})`;

  return (
    <div className={`relative inline-block ${className}`} style={{ width, height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        style={{ overflow: "visible" }}
      >
        {/* Area fill */}
        <path
          d={areaPath}
          fill={colour}
          fillOpacity={0.12}
          stroke="none"
        />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={colour}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hover hit areas + dots */}
        {points.map((p, i) => (
          <g key={i}>
            {/* Invisible hit area */}
            <rect
              x={p.x - 8}
              y={0}
              width={16}
              height={height}
              fill="transparent"
              onMouseEnter={() =>
                setTooltip({ x: p.x, y: p.y, score: p.score, date: p.date })
              }
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: "crosshair" }}
            />
            {/* Dot — only visible on hover or for first/last */}
            {(i === 0 || i === points.length - 1 || (tooltip && Math.abs(tooltip.x - p.x) < 2)) && (
              <circle
                cx={p.x}
                cy={p.y}
                r={2.5}
                fill={colour}
                stroke="white"
                strokeWidth={1}
              />
            )}
          </g>
        ))}

        {/* Y-axis labels (optional) */}
        {showLabels && (
          <>
            <text
              x={padX}
              y={padY + 6}
              fontSize={8}
              fill="#9ca3af"
              textAnchor="start"
            >
              {maxScore.toFixed(1)}
            </text>
            <text
              x={padX}
              y={height - padY}
              fontSize={8}
              fill="#9ca3af"
              textAnchor="start"
            >
              {minScore.toFixed(1)}
            </text>
          </>
        )}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg"
          style={{
            left: Math.min(tooltip.x + 8, width - 80),
            top: Math.max(tooltip.y - 28, 0),
            whiteSpace: "nowrap",
          }}
        >
          <span className="font-semibold">{tooltip.score.toFixed(3)}</span>
          <span className="ml-1 text-gray-400">{tooltip.date}</span>
        </div>
      )}
    </div>
  );
}

export default SparklineChart;
