#!/usr/bin/env python3
"""
fix-remaining-log-errors.py
─────────────────────────────────────────────────────────────────────────────
Fixes the 27 remaining TS errors after the logger migration.
Three patterns:
  A) log.warn/error("msg:", err)  → log.warn/error("msg:", errData(err))
     where err is a multi-line second arg (variable on its own line)
  B) log.warn("msg:", res.status, body)  → log.warn("msg:", { status: res.status, body })
     (3-arg calls — TS2554)
  C) log.error("msg", (error as Error).message)  → log.error("msg", errData(error))
  D) log.info("[tag]", summary)  → log.info("[tag]", { summary })
     where summary is a string
  E) log.error("msg", docId, err)  → log.error("msg", { docId, ...errData(err) })
"""

import re
from pathlib import Path

PROJECT_ROOT = Path("/home/ubuntu/ttruthdesk-platform")

# Each fix is (file, line_number_1based, old_text, new_text)
FIXES = [
    # alertDispatcher.ts:58 — 3 args: msg, res.status, body
    ("server/alertDispatcher.ts", 59,
     'log.warn("[AlertDispatcher] Telegram send failed:", res.status, body);',
     'log.warn("[AlertDispatcher] Telegram send failed:", { status: String(res.status), body });'),

    # analysisPipeline.ts:227 — multi-line, auditErr on own line
    ("server/analysisPipeline.ts", 228,
     '              auditErr',
     '              errData(auditErr)'),

    # analysisPipeline.ts:563
    ("server/analysisPipeline.ts", 564,
     '          predErr',
     '          errData(predErr)'),

    # analysisPipeline.ts:626
    ("server/analysisPipeline.ts", 627,
     '          chainErr',
     '          errData(chainErr)'),

    # analysisPipeline.ts:684
    ("server/analysisPipeline.ts", 684,
     'log.warn("[CompositeTruth] Stage 7 error (non-fatal):", compErr);',
     'log.warn("[CompositeTruth] Stage 7 error (non-fatal):", errData(compErr));'),

    # analysisPipeline.ts:730
    ("server/analysisPipeline.ts", 730,
     'log.warn("[GraphEdges] Stage 8 error (non-fatal):", graphErr);',
     'log.warn("[GraphEdges] Stage 8 error (non-fatal):", errData(graphErr));'),

    # autonomousIngest.ts:417 — multi-line, err on own line
    ("server/autonomousIngest.ts", 418,
     '            err',
     '            errData(err)'),

    # contradictionDetector.ts:301
    ("server/contradictionDetector.ts", 301,
     'log.warn("[ContradictionDetector] Pair upsert error:", pairErr);',
     'log.warn("[ContradictionDetector] Pair upsert error:", errData(pairErr));'),

    # frontier/frontierEngine.ts:125 — multi-line, err on own line
    ("server/frontier/frontierEngine.ts", 126,
     '      err',
     '      errData(err)'),

    # metaAgent/alertRouter.ts:133 — 3 args: msg, res.status, await res.text()
    ("server/metaAgent/alertRouter.ts", 133,
     'log.warn("[MetaAgent] Telegram send failed:", res.status, await res.text());',
     'log.warn("[MetaAgent] Telegram send failed:", { status: String(res.status), body: await res.text() });'),

    # monitoringJob.ts:192
    ("server/monitoringJob.ts", 192,
     'log.error(`[monitoring-job] Error processing doc ${doc.id}:`, docErr);',
     'log.error(`[monitoring-job] Error processing doc ${doc.id}:`, errData(docErr));'),

    # privateMode.ts:211 — string arg
    ("server/privateMode.ts", 211,
     'log.warn("[AuditLogger] Failed to write to file, logging to console:", line.trim());',
     'log.warn("[AuditLogger] Failed to write to file, logging to console:", { line: line.trim() });'),

    # qualityPassJob.ts:153
    ("server/qualityPassJob.ts", 153,
     'log.error("[QualityPass] Unexpected error:", outerErr);',
     'log.error("[QualityPass] Unexpected error:", errData(outerErr));'),

    # qualityPassJob.ts:175 — multi-line, feedbackErr on own line
    ("server/qualityPassJob.ts", 176,
     '      feedbackErr',
     '      errData(feedbackErr)'),

    # reEvaluationEngine.ts:155 — multi-line, err on own line
    ("server/reEvaluationEngine.ts", 156,
     '      err',
     '      errData(err)'),

    # reEvaluationEngine.ts:234 — multi-line, snapErr on own line
    ("server/reEvaluationEngine.ts", 235,
     '        snapErr',
     '        errData(snapErr)'),

    # reEvaluationEngine.ts:331 — multi-line, err on own line
    ("server/reEvaluationEngine.ts", 332,
     '        err',
     '        errData(err)'),

    # routers.ts:1082 — multi-line, auditErr on own line
    ("server/routers.ts", 1083,
     '            auditErr',
     '            errData(auditErr)'),

    # routers.ts:1584 — multi-line, err on own line
    ("server/routers.ts", 1585,
     '            err',
     '            errData(err)'),

    # sia/promptHarnessManager.ts:353 — multi-line, err on own line
    ("server/sia/promptHarnessManager.ts", 354,
     '      err',
     '      errData(err)'),

    # sia/qualityPassFeedbackCollector.ts:128 — multi-line, err on own line
    ("server/sia/qualityPassFeedbackCollector.ts", 129,
     '        err',
     '        errData(err)'),

    # sourceVersionAgent.ts:306 — err instanceof Error ? err.message : err
    ("server/sourceVersionAgent.ts", 307,
     '        err instanceof Error ? err.message : err',
     '        errData(err)'),

    # submitClaimRoute.ts:135 — 3 args: msg, docId, err
    ("server/submitClaimRoute.ts", 135,
     'log.error("[SubmitClaim] Pipeline error for doc", docId, err);',
     'log.error("[SubmitClaim] Pipeline error for doc", { docId: String(docId), ...errData(err) });'),

    # translateAndSearchApi.ts:216 — multi-line, err on own line
    ("server/translateAndSearchApi.ts", 217,
     '        err',
     '        errData(err)'),

    # verticalAdapters/biorxiv.ts:65 — (error as Error).message
    ("server/verticalAdapters/biorxiv.ts", 65,
     'log.error(`Error fetching from ${apiUrl}:`, (error as Error).message);',
     'log.error(`Error fetching from ${apiUrl}:`, errData(error));'),

    # verticalFeedMerger.ts:63 — multi-line, err on own line
    ("server/verticalFeedMerger.ts", 64,
     '      err',
     '      errData(err)'),

    # wikiLintJob.ts:53 — string arg (summary is a string)
    ("server/wikiLintJob.ts", 53,
     'log.info("[WikiEngineLint] Done.", summary);',
     'log.info("[WikiEngineLint] Done.", { summary });'),
]

def apply_fixes():
    count = 0
    for rel_path, line_num, old_text, new_text in FIXES:
        path = PROJECT_ROOT / rel_path
        lines = path.read_text(encoding="utf-8").split("\n")
        idx = line_num - 1  # 0-based
        if idx < len(lines) and old_text.strip() in lines[idx]:
            lines[idx] = lines[idx].replace(old_text.strip(), new_text.strip())
            path.write_text("\n".join(lines), encoding="utf-8")
            count += 1
            print(f"  ✓ {rel_path}:{line_num}")
        else:
            # Try searching nearby lines (±2)
            found = False
            for delta in [-1, 1, -2, 2]:
                check_idx = idx + delta
                if 0 <= check_idx < len(lines) and old_text.strip() in lines[check_idx]:
                    lines[check_idx] = lines[check_idx].replace(old_text.strip(), new_text.strip())
                    path.write_text("\n".join(lines), encoding="utf-8")
                    count += 1
                    print(f"  ✓ {rel_path}:{line_num} (found at ±{abs(delta)})")
                    found = True
                    break
            if not found:
                print(f"  ✗ MISS {rel_path}:{line_num} — '{old_text.strip()[:60]}'")
    print(f"\nApplied {count}/{len(FIXES)} fixes")

if __name__ == "__main__":
    apply_fixes()
