# Protein Truth Desk — Agent Context File

**READ THIS FIRST.** This file tells any new agent session exactly what to do before writing
a single line of code.

---

## Step 0: Session Integrity Check (MANDATORY — run before anything else)

```bash
# Pull or clone the persistent drive
if [ ! -d /home/ubuntu/manus-persistent-drive ]; then
  gh repo clone Gudmundur76/manus-persistent-drive /home/ubuntu/manus-persistent-drive
else
  cd /home/ubuntu/manus-persistent-drive && git pull
fi

# Run the integrity gate — must show 0 FAILURES before proceeding
cd /home/ubuntu/protein-truth-desk
node scripts/session-integrity.mjs
```

**If the integrity check shows FAILURES, fix them before writing code.**
This check verifies: persistent drive present and current, phase log exists, todo in sync,
TypeScript clean, all tests passing, stub count within threshold, ESLint 0 errors.

---

## Step 1: Bootstrap from Persistent Memory

```bash
# Pull latest state from the persistent drive
gh repo clone Gudmundur76/manus-persistent-drive /home/ubuntu/manus-persistent-drive 2>/dev/null \
  || git -C /home/ubuntu/manus-persistent-drive pull --rebase origin main

# Register this session and print context summary
node scripts/manus-session.mjs start
```

This will print:

- Current TODO progress (done/pending counts)
- Number of stub files remaining
- Last 5 sessions and what they accomplished
- Recent phase log

---

## Step 2: Read the Phase Log

```bash
cat /home/ubuntu/manus-persistent-drive/context/phase-log/phase_log.md
```

The phase log tells you what has been built, what is in progress, and what is planned next.
**Never start a phase that is already marked `done`.**

---

## Step 3: Check the Current State

```bash
# TypeScript must be clean before starting work
pnpm check

# All tests must pass before starting work
pnpm test

# Check stub count
node scripts/check-stubs.mjs
```

If tests are failing or TypeScript has errors, **fix them before doing anything else.**
Do not add new features on top of broken tests.

---

## Step 4: Work

Follow the plan in `todo.md`. Each phase is a section in todo.md. Work top-to-bottom.

**Non-negotiable rules:**

1. Every new function must have a Vitest test
2. No `as any` in non-test, non-stub files — use proper types
3. Functions must stay under 80 lines
4. Commit after every phase (not every 5 phases)
5. Use Conventional Commits: `feat(scope): description`

---

## Step 5: Verify Task Completion (MANDATORY — run before ending session)

```bash
# ALL 8 criteria must pass before ending the session.
# If this exits 1, fix the failures listed — do NOT end the session with failures.
pnpm task:done
```

The 8 criteria checked:

1. TypeScript: 0 errors
2. ESLint: 0 errors
3. All tests pass
4. No new stubs introduced
5. All todo.md items for this task are checked off
6. No orphaned TODO/FIXME comments added
7. Coverage thresholds met
8. New exported functions have tests

**If `pnpm task:done` fails:** fix the failures, do not skip. If a failure cannot be fixed this session, add it to todo.md as `[ ]` with the error message, then end the session. The next session starts by fixing that item.

See `TASK_COMPLETION_PROTOCOL.md` for the full definition of done.

---

## Step 6: End the Session

```bash
# Log the phase you completed
node scripts/manus-session.mjs log-phase 89 "Add task completion protocol" done

# Sync state to both repos and end session
node scripts/manus-session.mjs end "feat(quality): add task completion checker and protocol"
```

---

## Project Overview

**What it is:** A scientific claim verification platform for protein/nutrition research.
Ingests PubMed papers, extracts claims, scores them for quality, and provides a public API.

**Tech stack:** React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM + MySQL/TiDB

**Key files:**

- `drizzle/schema.ts` — 26 tables (claims, documents, entities, KG, provenance, API keys, etc.)
- `server/routers.ts` — all tRPC procedures (~2000 lines, split into feature sections)
- `server/db.ts` — Drizzle DB helpers
- `todo.md` — full phase log with 389+ items
- `client/src/App.tsx` — all routes

**Current phase:** 67 (Discipline Infrastructure)

**Stub files:** Run `node scripts/stub-tracker.mjs` to get current count and list.

---

## Quality Thresholds (enforced)

| Metric                | Current        | Target (Phase 70) |
| --------------------- | -------------- | ----------------- |
| Test pass rate        | 411/411 (100%) | 100% always       |
| Coverage (lines)      | ~65%           | 80%               |
| Stub files            | 15             | 0                 |
| `as any` in prod code | 29             | 0                 |
| Functions > 80 lines  | 32             | < 10              |

---

## Persistent Memory Repos

| Repo                                 | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| `Gudmundur76/protein-truth-desk`     | Full project codebase                           |
| `Gudmundur76/manus-persistent-drive` | Session state, phase log, KG snapshots, context |

Both must be pushed at the end of every session.
