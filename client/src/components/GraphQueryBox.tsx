/**
 * GraphQueryBox.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Natural language query interface for the Truth Desk knowledge graph.
 * Calls trpc.graph.query and renders the LLM answer with Streamdown markdown.
 */

import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

const EXAMPLE_QUESTIONS = [
  "Which PDB structures have contradicting resolution claims?",
  "What methods are most commonly used in structural biology papers?",
  "Are there any proteins with conflicting organism assignments?",
  "Which documents cite the most PDB structures?",
];

interface GraphQueryBoxProps {
  entityCount?: number;
  relationCount?: number;
  contradictionCount?: number;
  className?: string;
}

export function GraphQueryBox({
  entityCount = 0,
  relationCount = 0,
  contradictionCount = 0,
  className,
}: GraphQueryBoxProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerMeta, setAnswerMeta] = useState<{
    entityCount: number;
    relationCount: number;
    contradictionCount: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const queryMutation = trpc.graph.query.useMutation({
    onSuccess: (data) => {
      setAnswer(data.answer);
      setAnswerMeta({
        entityCount: data.entityCount,
        relationCount: data.relationCount,
        contradictionCount: data.contradictionCount,
      });
    },
  });

  const handleSubmit = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || queryMutation.isPending) return;
      setAnswer(null);
      setAnswerMeta(null);
      queryMutation.mutate({ question: trimmed });
    },
    [queryMutation]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleSubmit(question);
    },
    [question, handleSubmit]
  );

  return (
    <div className={cn("bg-[#0f1525]/95 border border-white/10 rounded-2xl p-5 space-y-4", className)}>
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">Ask the Knowledge Graph</h3>
        <p className="text-xs text-slate-500">
          {entityCount > 0
            ? `${entityCount} entities · ${relationCount} relations · ${contradictionCount} contradictions`
            : "Query the scientific memory across all audited documents"}
        </p>
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Which proteins have contradicting claims?"
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/60 transition-colors"
          disabled={queryMutation.isPending}
        />
        <button
          onClick={() => handleSubmit(question)}
          disabled={!question.trim() || queryMutation.isPending}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
        >
          {queryMutation.isPending ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              <span>Querying…</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <span>Ask</span>
            </>
          )}
        </button>
      </div>

      {/* Example questions */}
      {!answer && !queryMutation.isPending && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuestion(q);
                handleSubmit(q);
              }}
              className="text-[10px] px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {queryMutation.isError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400">Query failed. Please try again.</p>
        </div>
      )}

      {/* Answer */}
      {answer && (
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="prose prose-sm prose-invert max-w-none
              prose-p:text-slate-300 prose-p:leading-relaxed prose-p:my-1
              prose-headings:text-white prose-headings:text-sm prose-headings:font-semibold
              prose-code:text-green-300 prose-code:bg-white/5 prose-code:px-1 prose-code:rounded
              prose-strong:text-white prose-a:text-blue-400">
              <Streamdown>{answer}</Streamdown>
            </div>
          </div>
          {answerMeta && (
            <p className="text-[10px] text-slate-600">
              Traversed {answerMeta.entityCount} entities · {answerMeta.relationCount} relations · {answerMeta.contradictionCount} known contradictions
            </p>
          )}
          <button
            onClick={() => { setAnswer(null); setAnswerMeta(null); setQuestion(""); }}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Clear answer
          </button>
        </div>
      )}
    </div>
  );
}
