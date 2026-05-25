# Codebase Research — Bugs & Vulnerabilities

Short findings from static review of the customer support ticket API (`src/`, `prisma/`).

---

## Bugs (12)

| # | Location | Description |
|---|----------|-------------|
| 1 | `src/classification/rules.ts:61` | URGENT rule uses `/\nemergency\b/` (newline) instead of `/\bemergency\b/` — the word "emergency" never matches in normal text. |
| 2 | `src/repositories/tickets.repository.ts:174–176` | Search query `q` uses case-sensitive `contains`; SQLite does not support insensitive mode, so mixed-case searches miss results. |
| 3 | `src/services/tickets.service.ts:51–64` | Setting status to `resolved`/`closed` auto-fills `resolved_at`, but reopening the ticket does not clear it. |
| 4 | `src/services/tickets.service.ts`, `src/domain/ticket.schema.ts:39` | No check that `resolved_at` is on or after `created_at`; invalid dates are accepted. |
| 5 | `src/domain/ticket.schema.ts:39` | `resolved_at` is `z.date()` — JSON clients sending ISO strings get validation errors instead of coerced dates. |

---

## Vulnerabilities (5)

| # | Location | Severity | Description |
|---|----------|----------|-------------|
| 1 | `src/config/logger.ts:24` | **High** | Log redaction covers only email/password keys; ticket descriptions, customer names, and request URLs (incl. `?q=`) are still written to logs — PII leakage to log sinks. |
| 2 | `src/config/env.ts:17`, `src/app.ts:16` | **High** | `CORS_ORIGIN` defaults to `*` — combined with open API, any browser origin can call the service cross-site. |
| 3 | `src/api/middleware/errorHandler.ts:26` | **Medium** | Stack traces included in 500 JSON whenever `NODE_ENV !== 'production'` (default is `development`) — leaks paths and internals. |

---

