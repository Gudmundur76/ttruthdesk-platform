# Protein Truth Desk — Agent Context File

**READ THIS FIRST.** This file contains mandatory instructions for every agent session.
**Skipping any step is not permitted.**

---

## ⚡ QUICK START (copy-paste this at the start of every session)

```bash
cd /home/ubuntu/protein-truth-desk

# -1. MANDATORY: Meta-agent session-start check (drive staleness + phase log gap + session register)
pnpm meta:start

# 0. MANDATORY: Regenerate context snapshot FIRST (before reading anything)
pnpm context:snapshot && cat CONTEXT_SNAPSHOT.md

# 1. MANDATORY: Sync feature_list.json from todo.md (machine-readable contract)
pnpm feature:sync

# 2. Check for incomplete previous session
cat HANDOFF.md 2>/dev/null && echo "⚠️ HANDOFF EXISTS — complete it before new work"

# 3. Verify clean starting state
pnpm check && pnpm test && echo "✅ Clean state"
```

> **Steps -1, 0, and 1 are non-negotiable.**
> `pnpm meta:start` checks that `manus-persistent-drive` is not stale, that the phase log matches
> `todo.md`, and registers this session. If it reports a gap, run `pnpm drive:sync` at session end.
> `pnpm context:snapshot` regenerates `CONTEXT_SNAPSHOT.md` from the live codebase.
> `pnpm feature:sync` regenerates `feature_list.json` — the machine-readable contract that the
> `/admin/harness` Feature Contract panel reads. All three must run before any code changes.

If `HANDOFF.md` exists: **complete the handoff items first. Do not start new work.**
If tests fail or TypeScript has errors: **fix them first. Do not add features on broken code.**

---

## Step 0: Context Window Management (CRITICAL)

The context window is the #1 cause of incomplete sessions. Manage it proactively:

```bash
# Regenerate CONTEXT_SNAPSHOT.md at the START of every session
pnpm context:snapshot

# Read it — this gives you full project state in one file
cat CONTEXT_SNAPSHOT.md
```

**Rules for context window management:**

1. **At session start:** always run `pnpm context:snapshot` and read the output before touching any code
2. **Every 30 minutes of work:** run `pnpm context:snapshot` to refresh your understanding of what has changed
3. **When context feels degraded** (you are unsure what files exist, what was done, what is pending): stop immediately, run `pnpm context:snapshot`, read it, then continue
4. **Before ending a session:** run `pnpm context:snapshot` to capture final state for the next session
5. **Never rely on memory alone** for file names, function signatures, or DB schema — always re-read from source

**Signs that context is degrading:**

- You are unsure whether a function exists or where it is
- You are about to create a file that might already exist
- You cannot remember what the last 3 commits did
- You are writing code that contradicts the schema

When you see these signs: **stop, run `pnpm context:snapshot`, read it, then continue.**

---

## Step 1: Check for Incomplete Previous Session

```bash
# Check for HANDOFF.md from previous incomplete session
if [ -f HANDOFF.md ]; then
  echo "⚠️ PREVIOUS SESSION WAS INCOMPLETE"
  cat HANDOFF.md
fi

# Check for session audit result
if [ -f .session-audit.json ]; then
  cat .session-audit.json
fi
```

**If HANDOFF.md exists:**

1. Read it completely
2. Fix every item listed under "Uncompleted Todo Items"
3. Fix every item listed under "Missing Work"
4. Run `pnpm task:done` to verify
5. Run `pnpm session:audit` to verify semantically
6. Run `pnpm handoff --clear` to delete HANDOFF.md
7. Only then start new work

---

## Step 2: Verify Clean Starting State

```bash
pnpm check      # TypeScript: must be 0 errors
pnpm lint       # ESLint: must be 0 errors
pnpm test       # Tests: must all pass
```

If any of these fail: **fix them before writing a single line of new code.**

---

## Step 3: Work

Follow `todo.md`. Each phase is a section. Work top-to-bottom within the current phase.

**Non-negotiable rules:**

1. Every new exported function must have a Vitest test
2. No `as any` in non-test files — use proper types
3. Mark todo items `[x]` only after the code is committed and tests pass — never before
4. Commit after every phase: `git add -A && git commit -m "feat(scope): description"`
5. Use Conventional Commits: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`
6. If a task will take more than one session, split it into subtasks in todo.md first

**When a task is too large for one session:**

1. Add subtasks to todo.md as `[ ]` items before starting
2. Complete as many as possible
3. Run `pnpm handoff` before ending to document what remains
4. The next session reads HANDOFF.md and continues from there

---

## Step 4: Verify Task Completion (MANDATORY — run before ending session)

```bash
# Mechanical gate — ALL 8 criteria must pass
pnpm task:done

# Semantic gate — LLM checks if todo.md matches actual code
pnpm session:audit
```

**Both must exit 0 before the session ends.**

The 8 mechanical criteria (`pnpm task:done`):

1. TypeScript: 0 errors
2. ESLint: 0 errors
3. All tests pass
4. No new stubs introduced this session
5. All todo.md items for this phase are checked `[x]`
6. No orphaned TODO/FIXME comments added
7. Coverage thresholds met
8. New exported functions have tests

The semantic criteria (`pnpm session:audit`):

- LLM reads todo.md + git diff and verifies the code matches what is marked done
- Flags items marked `[x]` that have no corresponding code change
- Flags stubs or placeholders in "completed" code

**If either gate fails:**

- Fix the failures listed
- Do NOT end the session with failures
- If a failure genuinely cannot be fixed this session, add it to todo.md as `[ ]` with the error, run `pnpm handoff`, then end

---

## Step 5: End the Session

```bash
# 1. Regenerate context snapshot for next session
pnpm context:snapshot

# 2. If session is complete: clear any HANDOFF.md
pnpm handoff --clear

# 3. Commit everything
git add -A && git commit -m "chore: session complete — context snapshot updated"

# 4. Push to GitHub
git push origin main
```

**If session is INCOMPLETE:**

```bash
# Generate HANDOFF.md documenting what is unfinished
pnpm handoff

# Commit the handoff
git add -A && git commit -m "chore: session incomplete — handoff generated"
git push origin main

# Tell the user explicitly:
echo "⚠️ THIS SESSION IS INCOMPLETE. The next session must read HANDOFF.md first."
```

---

## Project Overview

**What it is:** A scientific claim verification platform for protein/structural biology research.
Ingests PubMed papers, extracts claims, scores them against PDB evidence, and provides a public API.

**Tech stack:** React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM + MySQL/TiDB

**Key files:**

- `CONTEXT_SNAPSHOT.md` — full project state snapshot (regenerate with `pnpm context:snapshot`)
- `HANDOFF.md` — incomplete session state (if it exists, read it first)
- `todo.md` — all phases and tasks with completion status
- `drizzle/schema.ts` — all DB tables
- `server/routers.ts` — all tRPC procedures
- `server/db.ts` — Drizzle DB helpers
- `client/src/App.tsx` — all routes
- `TASK_COMPLETION_PROTOCOL.md` — full definition of done

**Autonomous loop:** `server/autonomousLoop/` — 5 layers (Friction → Self-Prompt → Frontier → Truth → Meta)

---

## Quality Thresholds (enforced by pre-commit hook and CI)

| Metric            | Threshold                | Command                                |
| ----------------- | ------------------------ | -------------------------------------- |
| TypeScript errors | 0                        | `pnpm check`                           |
| ESLint errors     | 0                        | `pnpm lint`                            |
| Test pass rate    | 100%                     | `pnpm test`                            |
| Coverage (lines)  | ≥ 27% (raise each phase) | `pnpm test:coverage`                   |
| Stubs             | No new stubs per session | `pnpm stubs`                           |
| Task completion   | Both gates pass          | `pnpm task:done && pnpm session:audit` |

---

## All Available Quality Commands

```bash
pnpm check              # TypeScript type check
pnpm lint               # ESLint (0 errors required)
pnpm test               # Run all tests
pnpm test:watch         # Watch mode for active development
pnpm test:coverage      # Tests with coverage report
pnpm task:done          # Full mechanical quality gate
pnpm task:done:strict   # Mechanical gate + strict mode
pnpm session:audit      # LLM semantic completeness check
pnpm session:audit:json # JSON output for CI
pnpm handoff            # Generate HANDOFF.md (incomplete session)
pnpm handoff:clear      # Delete HANDOFF.md (session complete)
pnpm context:snapshot   # Regenerate CONTEXT_SNAPSHOT.md
pnpm stubs              # Stub tracker report
pnpm drift              # Drift detector report
pnpm integrity          # Session integrity check
```

---

## Persistent Memory Repos

| Repo                                 | Purpose                                |
| ------------------------------------ | -------------------------------------- |
| `Gudmundur76/protein-truth-desk`     | Full project codebase                  |
| `Gudmundur76/manus-persistent-drive` | Session state, phase log, KG snapshots |

Both must be pushed at the end of every session.
