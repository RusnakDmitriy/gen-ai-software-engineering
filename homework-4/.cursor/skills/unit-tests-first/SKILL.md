---
name: unit-tests-first
description: >-
  Generates and evaluates unit tests using the FIRST principles (Fast,
  Independent, Repeatable, Self-validating, Timely) with Vitest for homework-4.
  Use when writing unit tests, generating tests for changed code, reviewing test
  quality, or producing test-report.md for the Unit Test Generator agent.
---

# Unit Tests — FIRST

Generate and review **unit tests only** for code changed per `fix-summary.md`. Follow this skill and the project’s Vitest conventions. Write results to `test-report.md` (default at repo root or beside the bug context).

## When to apply

- **Unit Test Generator** agent (Task 4)
- User asks for unit tests, test coverage for fixes, or FIRST-compliant tests
- Input: `fix-summary.md` + list of changed files

**Scope rule**: Test **new or changed behavior only**. Do not rewrite unrelated suites.

## FIRST principles

Use FIRST as acceptance criteria for every test you add or review.

| Letter | Principle | Meaning | In this project |
|--------|-----------|---------|-----------------|
| **F** | **Fast** | Milliseconds per test; suite stays quick | Pure unit tests in `tests/unit/`; mock I/O; no `setTimeout` waits; no full HTTP server unless integration |
| **I** | **Independent** | Any order, any machine; no shared mutable state | Fresh data per test; `beforeEach`/`afterEach` cleanup; no reliance on prior `it()`; avoid global counters |
| **R** | **Repeatable** | Same pass/fail every run | Fixed inputs; `NODE_ENV=test`; use test DB (`DATABASE_URL=file:./prisma/test.db`); no network/time/random without control |
| **S** | **Self-validating** | Pass or fail without human judgment | Use `expect()` (Vitest); one logical assertion per behavior; no “check logs manually” |
| **T** | **Timely** | Written with the change they protect | Only cover files/lines from `fix-summary.md`; name tests after the fix behavior |

### Anti-patterns (violates FIRST)

- Sleeping or polling for async (not **Fast** / **Repeatable**)
- Tests that pass only when run after another file (not **Independent**)
- Shared DB rows without cleanup (not **Independent** / **Repeatable**)
- `console.log` as the only check (not **Self-validating**)
- Giant integration tests in `tests/unit/` (not **Fast**)
- Testing unchanged legacy code “while you’re here” (not **Timely**)

## Workflow

```
- [ ] 1. Read fix-summary.md — extract changed files and behaviors
- [ ] 2. Decide unit vs integration (default: unit in tests/unit/)
- [ ] 3. Add or extend tests for changed behavior only
- [ ] 4. Self-check each new test against FIRST checklist below
- [ ] 5. Run npm test (or npm run test:unit)
- [ ] 6. Write test-report.md
```

### FIRST checklist (per new test file or describe block)

```
- [ ] Fast: no unnecessary I/O, timers, or full app boot in unit tests
- [ ] Independent: isolated setup; no order dependency
- [ ] Repeatable: deterministic data; test env vars set
- [ ] Self-validating: expects cover success and failure paths
- [ ] Timely: maps to a specific change in fix-summary.md
```

## Project conventions

- **Runner**: Vitest (`npm test`, `npm run test:unit`)
- **Unit path**: `tests/unit/<module>.test.ts`
- **Imports**: ESM with `.js` suffix, e.g. `from '../../src/utils/pagination.js'`
- **API**: `import { describe, it, expect, vi, beforeEach } from 'vitest'`
- **Naming**: `describe` = module/function; `it` = one behavior in plain language
- **Integration** (DB/HTTP): `tests/integration/` — use only when unit isolation is impossible; note in report why

**Do not** edit production code unless the user explicitly asks; this skill is for tests and reporting.

## Output: test-report.md

Write a separate markdown file with:

```markdown
# Test Report

> Source: fix-summary.md
> Generated: [ISO date]
> Agent: Unit Test Generator

## Summary

| Check | Result |
|-------|--------|
| Tests added/updated | [files] |
| Command run | `npm run test:unit` or `npm test` |
| Exit code | 0 / non-zero |
| FIRST compliance | PASS / FAIL |

## Changes covered

| fix-summary item | Test file | FIRST notes |
|------------------|-----------|-------------|
| | | |

## FIRST assessment

| Principle | Status (PASS/FAIL) | Evidence |
|-----------|-------------------|----------|
| Fast | | |
| Independent | | |
| Repeatable | | |
| Self-validating | | |
| Timely | | |

## Failures (if any)

[Paste relevant Vitest output or "None"]

## References

- fix-summary.md
- Test files created/updated (paths)
```

For a blank template, see [report-template.md](report-template.md).

## Examples

**Good (FIRST)** — `tests/unit/pagination.test.ts` style:

```typescript
import { describe, it, expect } from 'vitest';
import { buildPaginationMeta } from '../../src/utils/pagination.js';

describe('buildPaginationMeta', () => {
  it('returns 0 totalPages when total is 0', () => {
    expect(buildPaginationMeta(1, 20, 0).totalPages).toBe(0);
  });
});
```

**Bad** — depends on another test’s DB row, uses delay, no assertion:

```typescript
it('works after previous test', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  // manual: start server and click import in browser
});
```
