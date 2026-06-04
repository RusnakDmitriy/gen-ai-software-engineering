---
name: research-quality-measurement
description: >-
  Measures research quality of codebase bug and security-vulnerability research,
  verifies file:line citations and code snippets against source, and writes a
  structured verification report. Use when verifying research/codebase-research.md,
  measuring research quality, fact-checking bug or security findings, or producing
  verified-research.md for the Bug Research Verifier agent.
---

# Research Quality Measurement

Verify bug and security research against the actual codebase, score research quality using the rubric below, and write results to a **separate file** (default: `research/verified-research.md`, or `context/bugs/<id>/research/verified-research.md` when working inside a bug folder).

Do **not** edit application source code or the research input file. Report only.

## When to apply

- User or agent runs **Bug Research Verifier** (Task 1)
- Input exists: `research/codebase-research.md` (or path given by user)
- Goal: fact-check claims, measure research quality, document discrepancies

## Workflow

Copy and track progress:

```
- [ ] 1. Read research document fully
- [ ] 2. Extract every verifiable claim (file:line, snippets, severity, repro steps)
- [ ] 3. Open each cited file and compare source to research
- [ ] 4. Independently spot-check high-risk areas (auth, input, uploads, DB, secrets)
- [ ] 5. Score each rubric dimension; assign overall level
- [ ] 6. Write report using template (all required sections)
```

### Step 1–2: Parse claims

For each finding, capture:

| Field | What to verify |
|-------|----------------|
| **Location** | Path exists; line numbers match the described symbol/logic |
| **Snippet** | Quoted code matches source (whitespace may differ; semantics must not) |
| **Bug / vuln description** | Behavior described is plausible from reading the code |
| **Severity** | Calibrated vs impact (data loss, auth bypass, DoS, info leak) |
| **Repro / evidence** | Steps or test commands are accurate if provided |

Label each claim: `VERIFIED`, `PARTIAL` (location ok, description overstated/understated), or `DISPUTED` (wrong file, line, snippet, or non-issue).

### Step 3–4: Source verification rules

- **Always read** cited files; never trust research from memory.
- **Stale lines**: If lines shifted but the same bug exists nearby, note as PARTIAL with corrected `file:line`.
- **Security**: Cross-check OWASP-style categories — injection, broken auth, sensitive data exposure, XXE, unsafe deserialization, misconfiguration, vulnerable components, logging of secrets.
- **Bugs**: Logic errors, unhandled promises, race conditions, wrong defaults, missing validation, error swallowing.

### Step 5: Research quality rubric

Score each dimension **0–3** (0 = missing/wrong, 1 = weak, 2 = adequate, 3 = strong). Overall **level** is derived from scores and discrepancy count.

| Dimension | 3 (strong) | 1 (weak) | 0 (missing) |
|-----------|------------|----------|-------------|
| **Citation accuracy** | All `file:line` and snippets match source | Frequent line drift or minor snippet gaps | Wrong paths or fabricated references |
| **Finding validity** | Bugs/vulns are real and correctly scoped | Some false positives or inflated severity | Mostly speculative or incorrect |
| **Coverage** | Critical paths reviewed (API, importers, middleware, config) | Gaps in obvious areas | Superficial or single-file only |
| **Actionability** | Clear repro, fix hint, or test angle per finding | Vague remediation | No next steps |
| **Severity calibration** | CRITICAL/HIGH/MEDIUM/LOW matches actual risk | Systematic over/under-rating | No severities or nonsense labels |

**Overall levels** (assign one):

| Level | Criteria |
|-------|----------|
| **EXCELLENT** | Sum ≥ 13/15, zero DISPUTED claims, ≤ 1 PARTIAL |
| **GOOD** | Sum ≥ 11/15, zero DISPUTED on HIGH/CRITICAL items |
| **ADEQUATE** | Sum ≥ 8/15, discrepancies documented, core findings still usable |
| **POOR** | Sum 5–7 OR multiple DISPUTED claims |
| **UNACCEPTABLE** | Sum &lt; 5 OR majority DISPUTED OR missing citations |

**Pass/fail** for verification:

- **PASS**: Overall level is ADEQUATE or better **and** no DISPUTED claim on a labeled CRITICAL/HIGH security issue without correction.
- **FAIL**: Otherwise. Bug Planner must not treat failed research as authoritative without human review.

## Output file

Write **one** markdown file. Default path: `research/verified-research.md`.

Use this structure exactly (required section headings):

```markdown
# Verified Research Report

> Source: [path to codebase-research.md]
> Verified: [ISO date]
> Verifier: [agent or role name]

## Verification Summary

| Check | Result |
|-------|--------|
| Overall verification | PASS \| FAIL |
| Claims verified | N / total |
| Claims partial | N |
| Claims disputed | N |
| Research quality (this skill) | EXCELLENT \| GOOD \| ADEQUATE \| POOR \| UNACCEPTABLE |

### Research Quality per skill

| Rubric dimension | Score (0–3) | Notes |
|------------------|-------------|-------|
| Citation accuracy | | |
| Finding validity | | |
| Coverage | | |
| Actionability | | |
| Severity calibration | | |
| **Total** | **/15** | |

## Verified Claims

For each claim from research (bugs and security findings):

### [Finding title or ID]

- **Status**: VERIFIED \| PARTIAL \| DISPUTED
- **Research reference**: `file:line` as cited
- **Corrected location** (if PARTIAL): `file:line`
- **Evidence**: Brief note — what you read in source that supports or refutes the claim
- **Snippet match**: Yes \| No \| N/A

## Discrepancies Found

List every PARTIAL and DISPUTED item. If none: `No discrepancies found.`

| # | Research claim | Issue | Corrected fact |
|---|----------------|-------|----------------|
| 1 | | | |

## Research Quality Assessment

**Level**: [EXCELLENT \| GOOD \| ADEQUATE \| POOR \| UNACCEPTABLE]

**Reasoning**: 2–4 sentences tying the level to rubric scores, discrepancy severity, and whether Bug Planner can safely use this research.

**Recommendations**: Bullet list — e.g. re-run research on module X, fix citations, downgrade severity on Y.

## References

- **Research input**: `[path](path)`
- **Source files examined**: bullet list of paths
- **Commands run** (if any): e.g. `npm test`, `npm run lint`
- **External standards** (optional): OWASP Top 10, CWE IDs cited in research
```

## Quality bar for the verifier

- Every finding in research appears in **Verified Claims** or **Discrepancies Found**.
- Do not mark VERIFIED without opening the file.
- Prefer PARTIAL over silent wrong lines; prefer DISPUTED over polite agreement.
- Keep **References** complete enough for Bug Planner to open the same files.

## Project context (homework-4)

Stack: Node/TypeScript, Express, Prisma, Vitest. High-value review targets:

- `src/api/middleware/` — validation, upload, errors
- `src/importers/` — CSV/JSON/XML parsing
- `src/services/` — business logic
- `src/config/env.ts` — secrets and configuration
- `src/repositories/` — data access

For report template copy-paste, see [report-template.md](report-template.md).
