import { cn } from "@/lib/utils";

export type Verdict =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | "Needs Expert Review";

const VERDICT_CLASSES: Record<string, string> = {
  Supported: "verdict-supported",
  Contradicted: "verdict-contradicted",
  "Partially Supported": "verdict-partial",
  Ambiguous: "verdict-ambiguous",
  "Insufficient Evidence": "verdict-insufficient",
  "Out of Scope": "verdict-oos",
  "Needs Expert Review": "verdict-expert",
};

interface VerdictBadgeProps {
  verdict: string;
  className?: string;
  size?: "sm" | "md";
}

export function VerdictBadge({ verdict, className, size = "md" }: VerdictBadgeProps) {
  const cls = VERDICT_CLASSES[verdict] ?? "verdict-insufficient";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold tracking-tight",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        cls,
        className
      )}
    >
      {verdict}
    </span>
  );
}
