# Security Report

> Source: research/fix-summary.md
> Generated: 2026-05-25T23:10:00Z
> Reviewer: Security Verifier
> Scope: files listed in fix-summary.md "Files Changed"

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 |
| INFO | 3 |
| **Total** | **5** |

| Check | Result |
|-------|--------|
| Files in scope | 8 |
| Files reviewed | 8 |
| Code edits made | 0 |
| Verdict | PASS-WITH-FINDINGS |

**Verdict rationale**: No CRITICAL or HIGH findings. All three planned security fixes (FIX-006 log redaction, FIX-007 CORS restriction, FIX-008 stack trace suppression) landed correctly. The five findings are defense-in-depth observations (2 LOW, 3 INFO) that do not represent exploitable vulnerabilities in the changed code.

## Findings

### SEC-001 — CORS_ORIGIN accepts wildcard via env override

- **Severity**: LOW
- **Category**: Misconfig
- **File**: `src/config/env.ts:18`
- **Snippet**:
  ```ts
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  ```
- **Risk**: The default was correctly changed from `*` to `http://localhost:3000` (FIX-007), but the Zod schema validates only that the value is a non-empty string. An operator can explicitly set `CORS_ORIGIN=*` in the environment, re-introducing the wildcard origin that FIX-007 intended to eliminate. This requires deliberate action and is not exploitable without admin access to environment configuration.
- **Remediation**: Add a Zod refinement to reject `*` as a value, e.g. `.refine(v => v !== '*', { message: 'Wildcard CORS origin is not allowed' })`, or validate with `z.string().url()` to enforce a proper origin format.
- **Related plan item**: FIX-007

### SEC-002 — AppError details always included in error responses

- **Severity**: LOW
- **Category**: Data exposure
- **File**: `src/api/middleware/errorHandler.ts:14`
- **Snippet**:
  ```ts
  res.status(err.statusCode).json({
    error: { code: err.code, message: err.message, details: err.details },
  });
  ```
- **Risk**: `AppError.details` is exposed in all environments (including production) without filtering. FIX-004 introduced a new `AppError` in `src/services/tickets.service.ts:72` with `{ resolved_at, created_at }` as details — these are timestamps and not sensitive. However, the unrestricted exposure pattern means any future `AppError` that includes PII or internal state in `details` would leak it to API consumers in production.
- **Remediation**: Consider redacting or omitting `details` in production responses, similar to the stack trace treatment in FIX-008, e.g. `details: env.NODE_ENV === 'development' ? err.details : undefined`. Alternatively, enforce a policy that `AppError.details` must never contain PII.
- **Related plan item**: FIX-008 (related pattern — stack trace suppression logic is nearby)

### SEC-003 — EXPOSE_STACK_TRACE not documented in .env.example

- **Severity**: INFO
- **Category**: Misconfig
- **File**: `.env.example:9`
- **Snippet**:
  ```
  CORS_ORIGIN=http://localhost:3000
  ```
- **Risk**: The new `EXPOSE_STACK_TRACE` environment variable (FIX-008) is defined in `src/config/env.ts:19` with `default(false)` but is not listed in `.env.example`. Operators using `.env.example` as a template will not be aware this option exists. No security impact since the default is secure (`false`), but the documentation gap could cause confusion.
- **Remediation**: Add `EXPOSE_STACK_TRACE=false` to `.env.example` with a comment noting it should only be enabled in development.
- **Related plan item**: FIX-008

### SEC-004 — Classification keywords not in log redaction list

- **Severity**: INFO
- **Category**: Data exposure
- **File**: `src/config/logger.ts:24-34`
- **Snippet**:
  ```ts
  redact: [
    '*.customer_email',
    '*.email',
    '*.password',
    '*.customer_name',
    '*.subject',
    '*.description',
    '*.url',
    'authorization',
    'req.url',
  ],
  ```
- **Risk**: FIX-006 correctly expanded the redaction list to cover PII fields. However, `*.keywords` is not redacted. Classification keywords (logged in `src/services/tickets.service.ts:32` and `src/services/tickets.service.ts:113`) are substrings extracted from user-submitted text via regex matches (e.g., "emergency", "password", "login"). While these are generic pattern-matched terms rather than raw user text, they do originate from user input and could theoretically hint at ticket content.
- **Remediation**: Consider adding `'*.keywords'` to the redaction list if ticket content confidentiality is a strict requirement. Alternatively, document the decision to keep keywords visible in logs as an intentional design choice for operational debugging.
- **Related plan item**: FIX-006

### SEC-005 — Type-level incompatibility may invite future raw SQL

- **Severity**: INFO
- **Category**: Injection
- **File**: `src/repositories/tickets.repository.ts:176-177`
- **Snippet**:
  ```ts
  { subject: { contains: q, mode: 'insensitive' } },
  { description: { contains: q, mode: 'insensitive' } }
  ```
- **Risk**: FIX-002 added `mode: 'insensitive'` to Prisma `contains` filters. This works at runtime but causes TypeScript compilation errors (`TS2353`) because SQLite's Prisma-generated types do not include the `mode` property in `StringFilter`. While not a current vulnerability, the persistent type error may prompt a future developer to replace this with a raw SQL query (e.g., `prisma.$queryRaw`) using string interpolation, which could introduce SQL injection if not parameterized correctly.
- **Remediation**: Resolve the type error by either (a) using `@ts-expect-error` with a comment explaining the SQLite runtime compatibility, (b) adding a `COLLATE NOCASE` migration to the SQLite schema, or (c) implementing a helper that uses `prisma.$queryRaw` with proper parameterized queries. This eliminates the incentive for a quick unsafe fix.
- **Related plan item**: FIX-002

## Categories scanned

| Category | Result |
|----------|--------|
| Injection | clean (SEC-005 is INFO-level future risk only) |
| Hardcoded secrets | clean |
| Insecure comparisons | clean |
| Missing validation | clean |
| Unsafe dependencies | clean |
| XSS / CSRF | N/A (JSON API, no HTML rendering in changed files) |
| AuthN / AuthZ | clean (no auth changes in scope) |
| Sensitive data exposure | 2 findings (SEC-002 LOW, SEC-004 INFO) |
| Misconfiguration | 2 findings (SEC-001 LOW, SEC-003 INFO) |
| Open redirect / SSRF | N/A (no URL fetches or redirects in changed files) |

## Planned security fix verification

| Fix | Description | Status |
|-----|-------------|--------|
| FIX-006 | Extend log redaction to cover PII | LANDED — redact list expanded from 4 paths to 9 paths in `src/config/logger.ts:24-34` |
| FIX-007 | Restrict CORS to specific origin | LANDED — default changed from `*` to `http://localhost:3000` in `src/config/env.ts:18`; `.env.example` updated; `src/app.ts:16` passes value to `cors()` correctly |
| FIX-008 | Suppress stack traces in non-production | LANDED — condition changed to require both `NODE_ENV === 'development'` and `EXPOSE_STACK_TRACE === true` in `src/api/middleware/errorHandler.ts:26`; new env var added in `src/config/env.ts:19` with `default(false)` |

## References

- `research/fix-summary.md`
- `research/verified-research.md` (for original severity comparison)
- Files reviewed:
  - `src/domain/ticket.schema.ts`
  - `src/services/tickets.service.ts`
  - `src/classification/rules.ts`
  - `src/repositories/tickets.repository.ts`
  - `src/config/logger.ts`
  - `src/config/env.ts`
  - `src/api/middleware/errorHandler.ts`
  - `.env.example`
- Additional context files read (not in scope, for verification only):
  - `src/app.ts` (CORS usage verification)
  - `src/domain/errors.ts` (AppError details verification)
  - `package.json` (dependency check)
- OWASP Top 10 2021: A05:2021 Security Misconfiguration (SEC-001, SEC-003), A04:2021 Insecure Design (SEC-002, SEC-005), A09:2021 Security Logging and Monitoring Failures (SEC-004)
- CWE-942 (Permissive CORS Policy), CWE-209 (Error Message Information Leak), CWE-532 (Insertion of Sensitive Information into Log File)
