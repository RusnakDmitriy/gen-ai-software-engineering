# Implementation Plan

> Source: research/verified-research.md
> Generated: 2026-05-25
> Planner: Bug Planner

## Summary

| Item | Count |
|------|-------|
| Bugs to fix | 5 |
| Vulnerabilities to fix | 3 |
| Excluded (DISPUTED) | 0 |
| Files touched | 8 |

## Sequencing

The fixes are ordered to respect dependencies and minimize risk:

1. **FIX-005** (Schema: date coercion) — Must come first; affects validation layer used by all date inputs
2. **FIX-004** (Schema: temporal validation) — Builds on FIX-005; adds refinement after coercion is in place
3. **FIX-001** (Classification: regex fix) — Independent; affects classification logic only
4. **FIX-002** (Repository: case-insensitive search) — Independent; affects search only
5. **FIX-003** (Service: clear resolved_at) — Independent; affects ticket update logic
6. **FIX-006** (Logging: PII redaction) — Independent; security fix for logging
7. **FIX-007** (CORS: restrict origin) — Independent; security fix for CORS config
8. **FIX-008** (Error handling: stack traces) — Independent; security fix for error responses

**Dependencies:**
- FIX-004 depends on FIX-005 (schema changes)
- All other fixes are independent and can be applied in any order after FIX-005

## Fixes

### FIX-001 — Fix URGENT priority emergency pattern regex

- **Source claim**: Bug #1 from verified-research.md
- **Severity**: MEDIUM
- **File**: `src/classification/rules.ts:61`
- **Before**:
  ```ts
  { pattern: /\nemergency\b/i, weight: 3 },
  ```
- **After**:
  ```ts
  { pattern: /\bemergency\b/i, weight: 3 },
  ```
- **Rationale**: The current pattern uses `\n` (literal newline) instead of `\b` (word boundary), preventing "emergency" from matching in normal text. Changing to `\b` enables the pattern to match "emergency" as a word anywhere in the text, consistent with other priority rules.
- **Dependencies**: none
- **Verification**: 
  - Run: `npm test -- tests/unit/classification/rules.test.ts`
  - Expected: Test for "emergency" keyword detection should pass
  - Manual check: Call `prioritize("this is an emergency")` and verify it returns `Priority.URGENT` with high confidence

---

### FIX-002 — Make SQLite search case-insensitive

- **Source claim**: Bug #2 from verified-research.md
- **Severity**: HIGH
- **File**: `src/repositories/tickets.repository.ts:174-176`
- **Before**:
  ```ts
  if (q) {
    where.OR = [{ subject: { contains: q } }, { description: { contains: q } }];
  }
  ```
- **After**:
  ```ts
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } }
    ];
  }
  ```
- **Rationale**: Prisma's `contains` operator on SQLite is case-sensitive by default. Adding `mode: 'insensitive'` makes searches case-insensitive, matching user expectations for text search (e.g., "password" should match "Password").
- **Dependencies**: none
- **Verification**:
  - Run: `npm test -- tests/integration/tickets.api.test.ts`
  - Expected: Search query tests with mixed-case terms should pass
  - Manual check: `GET /tickets?q=PASSWORD` should return tickets with "password", "Password", or "PASSWORD" in subject/description

---

### FIX-003 — Clear resolved_at when reopening ticket

- **Source claim**: Bug #3 from verified-research.md
- **Severity**: MEDIUM
- **File**: `src/services/tickets.service.ts:51-64`
- **Before**:
  ```ts
  async update(id: string, data: Partial<TicketUpdate>): Promise<Ticket> {
    await ticketsRepository.findByIdOrThrow(id);

    let payload: Partial<TicketUpdate> = data;
    if (data.status !== undefined && ['resolved', 'closed'].includes(data.status)) {
      if (data.resolved_at === undefined) {
        payload = { ...data, resolved_at: new Date() };
      }
    }

    const updated = await ticketsRepository.update(id, payload);
    logger.info({ ticketId: id }, 'ticket updated');
    return updated;
  }
  ```
- **After**:
  ```ts
  async update(id: string, data: Partial<TicketUpdate>): Promise<Ticket> {
    await ticketsRepository.findByIdOrThrow(id);

    let payload: Partial<TicketUpdate> = data;
    if (data.status !== undefined && ['resolved', 'closed'].includes(data.status)) {
      if (data.resolved_at === undefined) {
        payload = { ...data, resolved_at: new Date() };
      }
    } else if (data.status !== undefined && ['new', 'in_progress'].includes(data.status)) {
      if (data.resolved_at === undefined) {
        payload = { ...data, resolved_at: null };
      }
    }

    const updated = await ticketsRepository.update(id, payload);
    logger.info({ ticketId: id }, 'ticket updated');
    return updated;
  }
  ```
- **Rationale**: When a ticket is reopened (status changed to `new` or `in_progress`), the `resolved_at` timestamp should be cleared to indicate the ticket is no longer resolved. This prevents stale resolution timestamps from remaining on active tickets.
- **Dependencies**: none
- **Verification**:
  - Run: `npm test -- tests/unit/services/tickets.service.test.ts`
  - Expected: Test for reopening resolved ticket should verify `resolved_at` is null
  - Manual check: Create ticket → mark resolved → reopen to `new` → verify `resolved_at` is null

---

### FIX-004 — Add temporal validation for resolved_at

- **Source claim**: Bug #4 from verified-research.md
- **Severity**: MEDIUM
- **File**: `src/domain/ticket.schema.ts:39`
- **Before**:
  ```ts
  resolved_at: z.date().optional().nullable(),
  ```
- **After**:
  ```ts
  resolved_at: z.coerce.date().optional().nullable(),
  ```
  And add refinement to `TicketUpdateSchema`:
  ```ts
  export const TicketUpdateSchema = TicketCreateSchema.partial().omit({
    customer_id: true,
    customer_email: true,
    customer_name: true,
  }).extend({
    resolved_at: z.coerce.date().optional().nullable(),
    classification_confidence: z.number().optional().nullable(),
    classification_reasoning: z.string().optional().nullable(),
    classification_keywords: z.array(z.string()).optional().nullable(),
    classification_overridden: z.boolean().optional(),
  }).refine(
    (data) => {
      if (data.resolved_at && data.resolved_at !== null) {
        const now = new Date();
        return data.resolved_at <= now;
      }
      return true;
    },
    { message: 'resolved_at cannot be in the future' }
  );
  ```
  **Note**: Full temporal validation (`resolved_at >= created_at`) requires runtime context from the database. The schema refinement above prevents future dates. Service-layer validation (comparing to `created_at` from existing ticket) should be added in the service's `update` method.
  
  Add to `tickets.service.ts` before the repository update call:
  ```ts
  if (data.resolved_at && data.resolved_at !== null) {
    const existing = await ticketsRepository.findByIdOrThrow(id);
    if (data.resolved_at < existing.created_at) {
      throw new AppError(
        'VALIDATION_ERROR',
        'resolved_at cannot be before created_at',
        400,
        { resolved_at: data.resolved_at, created_at: existing.created_at }
      );
    }
  }
  ```
- **Rationale**: The schema currently accepts any date for `resolved_at` without validating temporal consistency. This fix adds:
  1. Date coercion (covered by FIX-005)
  2. Schema-level refinement to reject future dates
  3. Service-level validation to ensure `resolved_at >= created_at`
- **Dependencies**: FIX-005 (must apply coercion first)
- **Verification**:
  - Run: `npm test -- tests/unit/domain/ticket.schema.test.ts`
  - Expected: Schema validation tests for invalid `resolved_at` (future dates) should pass
  - Manual check: `PATCH /tickets/:id` with `resolved_at` in the future should return 400 error
  - Manual check: `PATCH /tickets/:id` with `resolved_at` before `created_at` should return 400 error

---

### FIX-005 — Add date coercion to resolved_at schema

- **Source claim**: Bug #5 from verified-research.md
- **Severity**: HIGH
- **File**: `src/domain/ticket.schema.ts:39`
- **Before**:
  ```ts
  resolved_at: z.date().optional().nullable(),
  ```
- **After**:
  ```ts
  resolved_at: z.coerce.date().optional().nullable(),
  ```
  **Also update** in `TicketSchema` at line 52:
  ```ts
  resolved_at: z.coerce.date().nullable(),
  ```
- **Rationale**: JSON clients send dates as ISO 8601 strings, but `z.date()` expects a JavaScript `Date` object. Without `z.coerce.date()`, the schema rejects valid ISO date strings, causing 400 validation errors. Adding coercion allows automatic conversion from ISO strings to `Date` objects.
- **Dependencies**: none
- **Verification**:
  - Run: `npm test -- tests/unit/domain/ticket.schema.test.ts`
  - Expected: Schema parsing tests with ISO date strings should pass
  - Manual check: `PATCH /tickets/:id` with `{"resolved_at": "2026-05-25T12:00:00Z"}` should accept the date string without validation error

---

### FIX-006 — Extend log redaction to cover PII

- **Source claim**: Vulnerability #1 from verified-research.md
- **Severity**: HIGH
- **File**: `src/config/logger.ts:24`
- **Before**:
  ```ts
  redact: ['*.customer_email', '*.email', '*.password', 'authorization'],
  ```
- **After**:
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
- **Rationale**: The current redaction list only covers email/password fields. Ticket `description` and `subject` may contain PII (e.g., phone numbers, addresses, SSNs). Customer names and request URLs with query parameters (e.g., `?q=sensitive`) also leak PII to logs. Expanding the redaction list prevents these leaks while maintaining log utility for debugging.
- **Dependencies**: none
- **Verification**:
  - Run: `npm test -- tests/unit/config/logger.test.ts` (if exists) or manual verification
  - Expected: Log entries with PII fields should show `[Redacted]` instead of actual values
  - Manual check: Create ticket with PII in description → check log output → verify `description`, `customer_name`, and `subject` are redacted

---

### FIX-007 — Restrict CORS to specific origin

- **Source claim**: Vulnerability #2 from verified-research.md
- **Severity**: CRITICAL
- **File**: `src/config/env.ts:17`
- **Before**:
  ```ts
  CORS_ORIGIN: z.string().default('*'),
  ```
- **After**:
  ```ts
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  ```
  **Additional change** in `.env.example` (create if missing):
  ```
  CORS_ORIGIN=http://localhost:3000
  ```
  **Documentation note**: Add comment in `env.ts` above line 17:
  ```ts
  // SECURITY: Set to specific origin(s) in production. Comma-separated list supported by app.ts if needed.
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  ```
- **Rationale**: The wildcard `*` origin allows any website to make cross-site requests to the API, enabling CSRF-style attacks. Restricting to a specific origin (localhost for dev, production domain in production) prevents unauthorized cross-origin access. The default is changed to `http://localhost:3000` for local development; production deployments must set this explicitly.
- **Dependencies**: none
- **Verification**:
  - Run: `npm test -- tests/integration/tickets.api.test.ts`
  - Expected: CORS headers should reflect the configured origin, not `*`
  - Manual check: Start server → inspect CORS response headers (`Access-Control-Allow-Origin`) → verify it matches `CORS_ORIGIN` env var, not wildcard
  - Security check: Attempt cross-origin request from unauthorized origin → should fail with CORS error

---

### FIX-008 — Suppress stack traces in non-production by default

- **Source claim**: Vulnerability #3 from verified-research.md
- **Severity**: MEDIUM
- **File**: `src/api/middleware/errorHandler.ts:26`
- **Before**:
  ```ts
  ...(env.NODE_ENV !== 'production' && { stack: error.stack }),
  ```
- **After**:
  ```ts
  ...(env.NODE_ENV === 'development' && env.EXPOSE_STACK_TRACE === true && { stack: error.stack }),
  ```
  **Additional change** in `src/config/env.ts`:
  Add new optional field:
  ```ts
  EXPOSE_STACK_TRACE: z.coerce.boolean().default(false),
  ```
- **Rationale**: The current logic exposes stack traces in all non-production environments (including staging, test, demo). Stack traces leak internal file paths, library versions, and code structure, aiding attackers. This fix requires explicit opt-in via `EXPOSE_STACK_TRACE=true` env var, and only honors it in `development` mode. Production and other environments never expose stack traces.
- **Dependencies**: none
- **Verification**:
  - Run: `npm test -- tests/integration/error-handling.test.ts` (if exists)
  - Expected: Error responses in test/staging should not include `stack` field unless explicitly enabled
  - Manual check: Trigger 500 error with `NODE_ENV=development` and `EXPOSE_STACK_TRACE=false` → verify response has no `stack` field
  - Manual check: Trigger 500 error with `NODE_ENV=development` and `EXPOSE_STACK_TRACE=true` → verify response includes `stack` field
  - Manual check: Trigger 500 error with `NODE_ENV=production` and `EXPOSE_STACK_TRACE=true` → verify response has no `stack` field (production override)

---

## Excluded findings

| Claim | Reason |
|-------|--------|
| (none) | All findings from verified-research.md are VERIFIED or PARTIAL and are included in this plan |

---

## Verification plan (overall)

### Pre-fix baseline
1. Run full test suite: `npm test`
2. Record current pass/fail count as baseline

### Post-fix verification
1. **Unit tests**: `npm test:unit` — All tests must pass
2. **Integration tests**: `npm test:integration` — All tests must pass, including new tests for:
   - Case-insensitive search (FIX-002)
   - Ticket reopening clearing `resolved_at` (FIX-003)
   - Date coercion and validation (FIX-004, FIX-005)
3. **Type checking**: `npm run typecheck` — No TypeScript errors
4. **Linting**: `npm run lint` — No lint errors
5. **Manual API verification**:
   - Test emergency classification: `POST /tickets` with "emergency" in description → verify URGENT priority
   - Test case-insensitive search: `GET /tickets?q=PASSWORD` → verify matches mixed-case results
   - Test ticket reopening: Resolve ticket → reopen → verify `resolved_at` is null
   - Test date validation: `PATCH /tickets/:id` with future `resolved_at` → verify 400 error
   - Test date coercion: `PATCH /tickets/:id` with ISO date string → verify 200 success
   - Test log redaction: Create ticket with PII → check logs → verify PII fields are redacted
   - Test CORS restriction: Check response headers → verify `Access-Control-Allow-Origin` is not `*`
   - Test stack trace suppression: Trigger error with `NODE_ENV=test` → verify no `stack` in response

### Security re-scan focus areas
The Security Verifier should focus on:
1. **CORS configuration** (`src/app.ts:16`, `src/config/env.ts:17`) — Verify origin is not wildcard
2. **Log redaction** (`src/config/logger.ts:24`) — Verify PII fields are in redact list
3. **Error handling** (`src/api/middleware/errorHandler.ts:26`) — Verify stack traces are not exposed by default
4. **Input validation** (`src/domain/ticket.schema.ts`) — Verify `resolved_at` date validation is in place

### Unit Test Generator scope
The Unit Test Generator should create tests for:
1. **Classification rules** (`src/classification/rules.ts`) — Test emergency pattern matching (FIX-001)
2. **Search repository** (`src/repositories/tickets.repository.ts`) — Test case-insensitive search (FIX-002)
3. **Ticket service** (`src/services/tickets.service.ts`) — Test `resolved_at` clearing on reopen (FIX-003) and temporal validation (FIX-004)
4. **Ticket schema** (`src/domain/ticket.schema.ts`) — Test date coercion (FIX-005) and validation (FIX-004)
5. **Logger config** (`src/config/logger.ts`) — Test redaction behavior (FIX-006)
6. **Error handler** (`src/api/middleware/errorHandler.ts`) — Test stack trace suppression (FIX-008)

---

## References

- `research/verified-research.md` (input)
- **Source files touched**:
  - `src/classification/rules.ts` (FIX-001)
  - `src/repositories/tickets.repository.ts` (FIX-002)
  - `src/services/tickets.service.ts` (FIX-003, FIX-004 service-layer)
  - `src/domain/ticket.schema.ts` (FIX-004 schema-layer, FIX-005)
  - `src/config/logger.ts` (FIX-006)
  - `src/config/env.ts` (FIX-007, FIX-008)
  - `src/app.ts` (context for FIX-007)
  - `src/api/middleware/errorHandler.ts` (FIX-008)
- **Config/documentation files**:
  - `.env.example` (recommended addition for FIX-007)
  - `README.md` (consider updating security section)
- **Test command**: `npm test` (Vitest)
- **External standards**: OWASP Top 10 2021 (A01, A04, A09)
