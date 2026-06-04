# Verified Research Report

> Source: research/codebase-research.md
> Verified: 2026-05-25
> Verifier: Bug Research Verifier

## Verification Summary

| Check | Result |
|-------|--------|
| Overall verification | PASS |
| Claims verified | 7 / 8 |
| Claims partial | 1 |
| Claims disputed | 0 |
| Research quality (this skill) | GOOD |

### Research Quality per skill

| Rubric dimension | Score (0–3) | Notes |
|------------------|-------------|-------|
| Citation accuracy | 3 | All file:line references match source; one line reference needs minor correction |
| Finding validity | 3 | All bugs and vulnerabilities are real and correctly described |
| Coverage | 2 | Covers key areas (classification, search, validation, logging, CORS, error handling) but misses some security-sensitive areas (XML entity processing, JSON import validation) |
| Actionability | 2 | Most findings are clear but lack specific fix suggestions or test commands |
| Severity calibration | 3 | Severity ratings are accurate and match actual risk |
| **Total** | **13/15** | |

## Verified Claims

### Bug #1: URGENT rule emergency pattern with newline

- **Status**: VERIFIED
- **Research reference**: `src/classification/rules.ts:61`
- **Corrected location**: N/A
- **Evidence**: Line 61 contains `{ pattern: /\nemergency\b/i, weight: 3 }` which uses `\n` (literal newline character) instead of `\b` (word boundary). This prevents the word "emergency" from matching in normal text.
- **Snippet match**: Yes

### Bug #2: Case-sensitive search query on SQLite

- **Status**: VERIFIED
- **Research reference**: `src/repositories/tickets.repository.ts:174–176`
- **Corrected location**: N/A
- **Evidence**: Lines 174-175 show `where.OR = [{ subject: { contains: q } }, { description: { contains: q } }];` using Prisma's `contains` operator. SQLite's LIKE operator used by Prisma is case-sensitive by default, which will miss mixed-case searches.
- **Snippet match**: Yes

### Bug #3: resolved_at not cleared when reopening ticket

- **Status**: VERIFIED
- **Research reference**: `src/services/tickets.service.ts:51–64`
- **Corrected location**: N/A
- **Evidence**: Lines 54-59 show that when status is set to `resolved` or `closed`, `resolved_at` is auto-filled with current date. However, when reopening a ticket (setting status back to `new` or `in_progress`), there is no logic to clear `resolved_at`, leaving stale resolution timestamps.
- **Snippet match**: Yes

### Bug #4: No validation that resolved_at is after created_at

- **Status**: PARTIAL
- **Research reference**: `src/services/tickets.service.ts`, `src/domain/ticket.schema.ts:39`
- **Corrected location**: `src/domain/ticket.schema.ts:39` is correct, but no validation exists at service layer or schema layer
- **Evidence**: Line 39 of `ticket.schema.ts` shows `resolved_at: z.date().optional().nullable()` with no custom refinement to check temporal ordering. The service layer in `tickets.service.ts` also does not validate that `resolved_at >= created_at`. Invalid dates can be accepted through API updates.
- **Snippet match**: Yes (for schema location)

### Bug #5: resolved_at schema does not coerce ISO strings

- **Status**: VERIFIED
- **Research reference**: `src/domain/ticket.schema.ts:39`
- **Corrected location**: N/A
- **Evidence**: Line 39 shows `resolved_at: z.date().optional().nullable()` without `z.coerce.date()` or `z.preprocess()` to convert ISO string inputs. JSON clients sending ISO date strings will get Zod validation errors instead of automatic coercion.
- **Snippet match**: Yes

### Vulnerability #1: Log redaction incomplete - PII leakage

- **Status**: VERIFIED
- **Research reference**: `src/config/logger.ts:24`
- **Corrected location**: N/A
- **Evidence**: Line 24 shows `redact: ['*.customer_email', '*.email', '*.password', 'authorization']` which only covers email/password fields. Ticket descriptions (potentially containing PII), customer names, and request URLs with query parameters (e.g., `?q=sensitive_data`) are not redacted and will be written to logs, leaking PII to log sinks.
- **Snippet match**: Yes

### Vulnerability #2: CORS_ORIGIN defaults to wildcard

- **Status**: VERIFIED
- **Research reference**: `src/config/env.ts:17`, `src/app.ts:16`
- **Corrected location**: N/A
- **Evidence**: Line 17 of `env.ts` shows `CORS_ORIGIN: z.string().default('*')` and line 16 of `app.ts` shows `app.use(cors({ origin: env.CORS_ORIGIN }))`. The wildcard default combined with the open API allows any browser origin to call the service cross-site, enabling CSRF-style attacks.
- **Snippet match**: Yes

### Vulnerability #3: Stack traces in non-production responses

- **Status**: VERIFIED
- **Research reference**: `src/api/middleware/errorHandler.ts:26`
- **Corrected location**: N/A
- **Evidence**: Line 26 shows `...(env.NODE_ENV !== 'production' && { stack: error.stack })` which includes full stack traces in 500 error responses whenever `NODE_ENV` is not `'production'`. The default value from `env.ts` is `'development'`, so stack traces (leaking paths and internals) are exposed by default.
- **Snippet match**: Yes

## Discrepancies Found

| # | Research claim | Issue | Corrected fact |
|---|----------------|-------|----------------|
| 1 | Bug #4 cites both `src/services/tickets.service.ts` and `src/domain/ticket.schema.ts:39` | Citation is vague about which file:line contains the issue | The bug exists at the schema level (`ticket.schema.ts:39`) with no validation. Service layer also does not implement validation. Both locations are relevant but schema is primary. |

## Research Quality Assessment

**Level**: GOOD

**Reasoning**: The research achieved 13/15 on the rubric, with all core citations accurate and findings valid. All 8 claims represent real bugs or vulnerabilities with correct severity calibration. One PARTIAL rating was due to multi-file citation ambiguity rather than factual error. Coverage is adequate for the critical paths examined (classification rules, search, validation, logging, CORS, error handling) but misses some high-risk areas like XML entity expansion controls (`processEntities: false` in `xml.importer.ts` is correct but not documented) and JSON import size limits. Actionability is adequate but could be improved with specific repro steps or test commands.

**Recommendations**:

- Research is **safe for Bug Planner to use** as authoritative input
- Consider re-reviewing importers (`src/importers/*.ts`) for additional vulnerabilities:
  - XML: `processEntities: false` prevents XXE but this security control is not documented in research
  - JSON: No maximum array size check beyond file size limit; large arrays could cause memory issues
  - CSV: `relax_column_count: false` is good but not documented
- Add specific reproduction steps or test commands to improve actionability
- Consider reviewing authentication/authorization middleware (if present) for coverage completeness

## References

- **Research input**: `research/codebase-research.md`
- **Source files examined**:
  - `src/classification/rules.ts`
  - `src/repositories/tickets.repository.ts`
  - `src/services/tickets.service.ts`
  - `src/domain/ticket.schema.ts`
  - `src/config/logger.ts`
  - `src/config/env.ts`
  - `src/app.ts`
  - `src/api/middleware/errorHandler.ts`
  - `src/api/middleware/upload.ts`
  - `src/api/middleware/validate.ts`
  - `src/importers/csv.importer.ts`
  - `src/importers/json.importer.ts`
  - `src/importers/xml.importer.ts`
- **Commands run**: None
- **External standards**: OWASP Top 10 (A01:2021 - Broken Access Control for CORS, A04:2021 - Insecure Design for validation gaps, A09:2021 - Security Logging and Monitoring Failures for log redaction)
