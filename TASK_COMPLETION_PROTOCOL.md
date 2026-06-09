# Task Completion Protocol

**The single most important rule in this codebase:**

> A task is not done until `pnpm task:done` exits 0.

Partial work is worse than no work. Every incomplete task creates a gap that compounds with the next session, producing stubs that reference broken APIs, tests that mock non-existent functions, and UI that renders placeholder content to real users. This protocol exists to prevent that.

---

## Definition of Done (8 Criteria)

All 8 must pass before a task is considered complete. The `pnpm task:done` script checks all of them automatically.

| #   | Criterion                 | Tool                   | Failure means                          |
| --- | ------------------------- | ---------------------- | -------------------------------------- |
| 1   | TypeScript: 0 errors      | `pnpm check`           | Code will not compile in production    |
| 2   | ESLint: 0 errors          | `pnpm lint`            | Code quality regression introduced     |
| 3   | All tests pass            | `pnpm test`            | Existing behaviour broken              |
| 4   | No new stubs              | `pnpm stubs`           | Placeholder code shipped to production |
| 5   | todo.md fully checked     | Manual                 | Task scope was not completed           |
| 6   | No orphaned TODO comments | `git diff`             | Technical debt added without tracking  |
| 7   | Coverage thresholds met   | `pnpm test:coverage`   | Test floor dropped below baseline      |
| 8   | New exports have tests    | `git diff` + test scan | New code is untested                   |

---

## How to Use

### At the end of every task:

```bash
pnpm task:done
```

If it exits 0: safe to checkpoint and end session.
If it exits 1: fix the failures listed, then run again.

### For strict mode (warnings also fail):

```bash
pnpm task:done:strict
```

Use this before major releases or when raising the quality bar.

### With a task name for logging:

```bash
pnpm task:done -- --task "Phase 89: Add coord queue drainer"
```

---

## Why Tasks Get Left Incomplete

The most common causes of partial completion in AI-assisted development:

1. **Context window pressure** — the agent runs out of context and stops mid-task without signalling incompleteness. **Fix:** The pre-commit hook now runs `pnpm task:done` and blocks commits if it fails.

2. **Scope creep mid-task** — a new issue is discovered while implementing, the agent pivots to fix it, and the original task is never finished. **Fix:** Add the new issue to `todo.md` as a `[ ]` item immediately, finish the current task, then start the new one.

3. **Stub-and-move-on** — a function is written with a `// STUB` body to unblock other work, then never filled in. **Fix:** The stub tracker counts stubs. The completion checker fails if the stub count increases.

4. **Test-after-the-fact** — code is written, the session ends, and tests are "planned for next session". **Fix:** Criterion 8 checks that new exports have tests in the same session.

5. **Optimistic todo marking** — todo items are marked `[x]` before the implementation is verified. **Fix:** Only mark `[x]` after `pnpm task:done` passes.

---

## The Non-Negotiable Rules

These rules are enforced by the pre-commit hook and cannot be bypassed:

```
1. pnpm check must exit 0 before commit
2. pnpm lint must exit 0 before commit
3. pnpm test must exit 0 before commit
4. pnpm task:done must exit 0 before session end
```

If you are tempted to skip these, that is a signal the task scope is too large. Split it into smaller tasks instead.

---

## For Manus Sessions Specifically

At the start of every session:

```bash
node scripts/session-integrity.mjs
```

At the end of every session, before `webdev_save_checkpoint`:

```bash
pnpm task:done
```

If `pnpm task:done` fails, do not end the session. Fix the failures first. If the failures cannot be fixed in the current session (e.g., a large refactor is needed), document the exact failure in `todo.md` as a `[ ]` item with the error message, then end the session. The next session starts by fixing that item before doing anything else.

---

## Raising the Quality Bar

Coverage thresholds are set in `vitest.config.ts`. Raise them by 5% every 2–3 phases:

| Phase        | Lines | Functions | Branches |
| ------------ | ----- | --------- | -------- |
| Current (89) | 26%   | 36%       | 48%      |
| Target (92)  | 35%   | 45%       | 55%      |
| Target (96)  | 50%   | 60%       | 65%      |
| Final        | 70%   | 70%       | 70%      |

After raising thresholds, run `pnpm task:done` to verify the new floor is met before committing.
