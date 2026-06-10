import DashboardLayout from "@/components/DashboardLayout";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { trpc } from "@/lib/trpc";
import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
} from "lucide-react";

// ─── Verdict badge colours ────────────────────────────────────────────────────

const VERDICT_META: Record<
  string,
  {
    label: string;
    icon: React.ReactNode;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  Supported: {
    label: "Supported",
    icon: <CheckCircle2 className="h-3.5 w-3.5 mr-1" />,
    variant: "default",
  },
  Contradicted: {
    label: "Contradicted",
    icon: <XCircle className="h-3.5 w-3.5 mr-1" />,
    variant: "destructive",
  },
  "Partially Supported": {
    label: "Partially Supported",
    icon: <AlertCircle className="h-3.5 w-3.5 mr-1" />,
    variant: "secondary",
  },
  Ambiguous: {
    label: "Ambiguous",
    icon: <HelpCircle className="h-3.5 w-3.5 mr-1" />,
    variant: "outline",
  },
  "Insufficient Evidence": {
    label: "Insufficient Evidence",
    icon: <HelpCircle className="h-3.5 w-3.5 mr-1" />,
    variant: "outline",
  },
  "Out of Scope": {
    label: "Out of Scope",
    icon: <HelpCircle className="h-3.5 w-3.5 mr-1" />,
    variant: "outline",
  },
  "Needs Expert Review": {
    label: "Needs Expert Review",
    icon: <AlertCircle className="h-3.5 w-3.5 mr-1" />,
    variant: "secondary",
  },
};

// ─── Claim result card ────────────────────────────────────────────────────────

type ClaimResult = {
  claimText: string;
  verdict: string;
  rationale: string;
  evidenceUrl: string | null;
  pubmedResults: Array<{
    pmid: string;
    title: string;
    abstractSnippet: string;
    citationUrl: string;
    authors: string[];
    journal?: string;
    year?: number;
  }>;
};

function ClaimCard({ claim }: { claim: ClaimResult }) {
  const meta =
    VERDICT_META[claim.verdict] ?? VERDICT_META["Insufficient Evidence"];
  return (
    <Card className="text-sm">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start gap-2 flex-wrap">
          <Badge variant={meta.variant} className="flex items-center shrink-0">
            {meta.icon}
            {meta.label}
          </Badge>
          <CardTitle className="text-sm font-medium leading-snug">
            {claim.claimText}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {claim.rationale && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {claim.rationale}
          </p>
        )}
        {claim.evidenceUrl && (
          <a
            href={claim.evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View PDB evidence
          </a>
        )}
        {claim.pubmedResults.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                PubMed citations
              </p>
              {claim.pubmedResults.slice(0, 3).map(pub => (
                <div key={pub.pmid} className="space-y-0.5">
                  <a
                    href={pub.citationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline leading-snug block"
                  >
                    {pub.title}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {pub.authors.slice(0, 3).join(", ")}
                    {pub.authors.length > 3 ? " et al." : ""}
                    {pub.journal ? ` · ${pub.journal}` : ""}
                    {pub.year ? ` (${pub.year})` : ""}
                    {" · "}
                    <span className="font-mono">PMID:{pub.pmid}</span>
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "Can sludge from salmon farming become a biotech product?",
  "Does collagen from fish skin have antimicrobial properties?",
  "Is myosin from Atlantic salmon structurally similar to human cardiac myosin?",
  "What proteins in shrimp shells are useful for wound healing?",
  "Can keratin from fish scales be used in drug delivery?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [claimResults, setClaimResults] = useState<ClaimResult[]>([]);

  const chatMutation = trpc.chat.query.useMutation({
    onSuccess(data) {
      // Append the assistant summary as a message
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.summary },
      ]);
      // Store claim results for the evidence panel
      setClaimResults(data.claims as ClaimResult[]);
    },
    onError(err) {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `**Error:** ${err.message ?? "Something went wrong. Please try again."}`,
        },
      ]);
    },
  });

  const handleSend = useCallback(
    (content: string) => {
      // Append user message immediately
      setMessages(prev => [...prev, { role: "user", content }]);
      // Clear previous claim results while loading
      setClaimResults([]);
      chatMutation.mutate({ question: content });
    },
    [chatMutation]
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 h-full max-w-5xl mx-auto">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Truth Desk AI
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ask any protein or biotech question. Claims are verified against
            PubMed and the Protein Data Bank before you see an answer.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
          {/* Chat panel */}
          <div className="flex-1 min-w-0">
            <AIChatBox
              messages={messages}
              onSendMessage={handleSend}
              isLoading={chatMutation.isPending}
              placeholder="Ask a protein or biotech question…"
              height="calc(100vh - 220px)"
              emptyStateMessage="Ask a question about proteins, biotech, or molecular biology. Every answer is verified against peer-reviewed evidence."
              suggestedPrompts={SUGGESTED_PROMPTS}
            />
          </div>

          {/* Evidence panel — only shown when there are claim results */}
          {claimResults.length > 0 && (
            <div className="lg:w-96 shrink-0 space-y-3 overflow-y-auto max-h-[calc(100vh-220px)]">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                Evidence breakdown ({claimResults.length} claim
                {claimResults.length !== 1 ? "s" : ""})
              </p>
              {claimResults.map((claim, i) => (
                <ClaimCard key={i} claim={claim} />
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
