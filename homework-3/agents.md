# agents.md — Operating Guide for AI Coding Partners on Lumen Cards

> **What this file is.** Operating rules for any AI coding partner (Cursor, Copilot, Claude Code, Codex, etc.) working in this repository. It encodes the non-negotiables that the team enforces in code review so the agent reaches a passing PR without re-deriving the rules every time.
>
> **What this file is not.** A product spec. The product spec is [`specification.md`](./specification.md), structured as Parts A–E with global Task IDs (A1–A15, B1–B11, C1–C13, D1–D12). When this guide references a Task ID, follow that task's full text in `specification.md`.
>
> **Precedence when rules conflict.** (1) Compliance/security rules in this file > (2) Task IDs in `specification.md` > (3) Editor rules under `.cursor/rules/` > (4) Stylistic conventions in this file > (5) Agent's own judgment. If two non-negotiables seem to conflict, **stop and ask** rather than guess.

---

## 1. Project context (read this first)

- **Product.** Lumen Cards — a neobank-style virtual card lifecycle platform issuing EUR virtual cards backed by **Stripe Issuing**. End-users issue, freeze, set limits on, replace, dispute, and close cards from a single EUR wallet.
- **Stakeholders.** End-user (mobile + web), Internal Ops/Compliance, Customer Support, Fraud analyst. No partner/B2B consumers in MVP (Task C11 is held behind a feature flag).
- **Regulatory frame.** EU/EEA. **PSD2** (Strong Customer Authentication for sensitive actions), **GDPR** (lawful basis, minimization, pseudonymization, erasure), **PCI DSS** (Lumen Cards is **out-of-CDE** by design — see §6), **EBA Guidelines on outsourcing** (Stripe Issuing is treated as a critical processor).
- **Data residency.** EU-only. AWS `eu-west-1` (primary) + `eu-central-1` (warm DR). No cross-border transfer of personal data without an explicit `SCC`-backed exception documented in `infra/policies/`.
- **Scale tier.** ~5M cards, ~500 authorizations/sec peak, 99.95% monthly SLO for the authorization path, 99.9% for the user API.

If any of the above is unclear in the current task, **stop and ask**. Do not infer scope.

---

## 2. Tech stack assumptions

| Concern | Assumed choice | Notes |
|---------|----------------|-------|
| Runtime | Node.js **20 LTS** | Pin via `.nvmrc`. Do not use experimental flags. |
| Language | **TypeScript** with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` | No `any` in production code. Use branded types for IDs (see §5). |
| Framework | **NestJS 10** | Modular monolith per bounded context, exposed as microservices via `cards-svc`, `transactions-svc`, `disputes-svc`, `notifications-svc`, `audit-svc`, `bff-user`, `bff-internal`. |
| Database | **PostgreSQL 16** | One schema per service. Migrations via `node-pg-migrate`. `TIMESTAMPTZ` in UTC. Monetary fields as `BIGINT` minor units. |
| Cache / locks | **Redis 7** | Idempotency cache (Task C5), rate limits (B7), session lookups (C8). No business state in Redis. |
| Eventing | **Apache Kafka** + transactional outbox (A13) | Topic naming `lumen.<context>.<entity>.<event>.v<n>`. Avro schemas in `libs/events/`. Consumers are idempotent. |
| Object storage | **AWS S3** in EU regions, **SSE-KMS** customer-managed keys (B5) | Audit watermarks have **Object Lock** retention. |
| API contracts | **OpenAPI 3.1** in `libs/contracts/openapi/` | Source of truth (C3). `@nestjs/swagger` decorators must match. |
| Payment processor | **Stripe Issuing** sandbox in non-prod; prod under DPA | Treat as a critical sub-processor (B11). |
| Identity | `identity-svc` (assumed upstream) | Issues session cookies (C8) and `scaProof` JWTs (B1). |
| Testing | **Jest + ts-jest + supertest + Testcontainers + fast-check + k6 + Stryker** | See §11 and Part D of the spec. |
| Observability | OpenTelemetry traces + Prometheus metrics + structured JSON logs | Span/log correlation via `X-Correlation-Id` (C6). |
| Tooling | **pnpm** workspaces, **Turborepo**, **ESLint** + **Prettier**, **commitlint** (Conventional Commits) | Pre-commit hooks via `lefthook`. |

If a task requires a library not listed here, propose it in the PR description and wait for approval before adding it.

---

## 3. Repository layout

```text
services/
  cards-svc/           # Issuance, lifecycle FSM, controls (Part A: A1–A5, A8–A10)
  transactions-svc/    # Stripe webhook ingestion + projection (A6–A7)
  disputes-svc/        # Dispute intake & evidence (A11)
  notifications-svc/   # Push/email/SMS fan-out (A14)
  audit-svc/           # Hash-chained audit log (B2)
  bff-user/            # End-user REST surface
  bff-internal/        # Ops/Support/Fraud REST surface (A12, B8)
libs/
  contracts/           # OpenAPI YAML, DTOs, error catalog (C2), pagination (C4), idempotency (C5), correlation (C6)
  events/              # Avro schemas + pseudonymizer (B4)
  sdk-ts/              # Generated SDK (C9)
  test-fixtures/       # Shared deterministic factories
infra/
  terraform/           # KMS (B5), RDS, S3, MSK, CloudFront + WAF
  observability/       # SLOs, alerts (B9), runbooks (B9)
  policies/            # OPA/Rego policies (data residency, deploy gates)
tools/
  contract-drift/      # OpenAPI ↔ code gate (C3)
  stripe-fixtures/     # Recorded fixtures (D3)
  perf/                # k6 scenarios (D7)
  compliance/          # Audit/GDPR/retention evidence (D9)
  chaos/               # Fault-injection scenarios (D10)
docs/
  pci-scope.md, ropa.md, error-codes.md, runbooks/, drills/, migrations/
```

**Rules:**
- Do **not** introduce a new top-level folder without an entry under `docs/` explaining its purpose.
- Do **not** put domain logic in `bff-*` services. BFFs are thin adapters between HTTP and the domain services.
- Do **not** import across service package boundaries; share via `libs/` only.

---

## 4. Domain rules (banking-specific)

These are not style preferences. They are correctness invariants.

1. **Monetary values are integer `BIGINT` minor units** with an explicit currency. MVP currency is `EUR` only. No floats anywhere. Use `bigint` in TypeScript. For arithmetic that requires non-integer factors, use `big.js` with explicit rounding mode (`ROUND_HALF_EVEN`). Never `parseFloat`. Never `Number` for amounts.
2. **All public IDs are ULIDs prefixed by entity type** (`card_01H...`, `txn_01H...`, `dsp_01H...`, `evt_01H...`). Stripe-side ids are opaque strings stored only on the boundary entity. Use branded types `CardId`, `WalletId`, `UserId`, `StripeCardId`, `TransactionId` so the compiler prevents mixing.
3. **Card lifecycle is a strict FSM** (A1). Legal transitions only: `PENDING → ACTIVE`, `ACTIVE ↔ FROZEN`, `ACTIVE/FROZEN → CLOSED`, `ACTIVE → REPLACED → CLOSED(predecessor)` with a successor. Anything else is `409 card.illegal_transition`. Never bypass the FSM with raw `UPDATE` statements.
4. **Optimistic locking with a `version` column** on every aggregate (`cards`, `disputes`, `wallets` view). Concurrent writers surface `409 resource.version_conflict`. Never retry blind; surface the conflict.
5. **Idempotency is mandatory for every non-GET, non-HEAD route** (C5). The middleware persists `(idempotency_key, user_id, request_hash) → response` for 24h. Same key + different body → `422 idempotency.body_mismatch`. Same key + same body → cached response, no downstream side effect.
6. **Audit every state change and every admin/sensitive action** (B2). The audit row is part of the same database transaction as the state change (outbox to `audit-svc`). If there is no audit, the action did not happen.
7. **PSD2 SCA for sensitive actions** (B1). PAN/CVV reveal, replacement, dispute open, and limit increases above thresholds require a fresh `scaProof` JWT. The `@ScaRequired` decorator + guard is the only legitimate gate; never check SCA inline in a handler.
8. **Stripe is the source of truth for card-network state**, Lumen Cards is the source of truth for its own audit, lifecycle metadata, and user surface. When in doubt, reconcile from Stripe webhooks (A6) rather than overwrite locally.
9. **Webhooks are at-least-once.** All consumers must be idempotent (dedupe by `event.id` in an inbox table, B6). Never assume "exactly once".
10. **GDPR lawful basis must be documented** for every new processing activity in `docs/ropa.md`. If you add a field that holds personal data, you must update the RoPA entry in the same PR.
11. **EU data residency is enforced at deploy time.** Resources outside EU regions are rejected by `infra/policies/data-residency.rego`. Do not bypass with overrides.

---

## 5. Code style

### TypeScript
- `strict: true`. No `any`, no `as unknown as T` smuggling, no `@ts-ignore`. Use `@ts-expect-error <reason>` only with a justification in the same line.
- Prefer `readonly` arrays and `Readonly<T>` for inputs to pure functions.
- **Branded ID types** are mandatory:

```typescript
type CardId = string & { readonly __brand: 'CardId' };
const CardId = (raw: string): CardId => {
  if (!/^card_[0-9A-HJKMNP-TV-Z]{26}$/.test(raw)) {
    throw new LumenError('id.invalid', { field: 'cardId' });
  }
  return raw as CardId;
};
```

- DTOs use `class-validator` + `class-transformer` in **whitelist** mode. Unknown fields → `422 validation.unknown_field`.
- Errors thrown across module boundaries are always `LumenError` with a code from the central catalog (C2). Never throw raw `Error`, `string`, or library-specific errors.
- Pure domain logic lives in `*.entity.ts` / `*.fsm.ts` and has **zero** infrastructure imports (no NestJS, no Prisma, no Stripe SDK).

### NestJS
- One module per bounded context. Controllers are thin; handlers (application layer) hold the logic; repositories are infra-layer.
- Use **global** filters/guards/interceptors only for cross-cutting concerns documented in this file (correlation, idempotency, exception filter, RBAC). Never silently change global behavior in a PR — call it out in the PR description.
- Do not call `process.env` inside services; load via `@nestjs/config` and inject typed config.

### Naming
- File names: `kebab-case.ts`. Class names: `PascalCase`. Functions/variables: `camelCase`. Constants: `SCREAMING_SNAKE_CASE` only for exported module-level constants.
- Avoid abbreviations except: `id`, `dto`, `bff`, `pan`/`cvv` (banned in code; allowed in comments referencing why a thing is forbidden), `fsm`, `mfa`, `sca`.
- Test files mirror source: `foo.ts` → `foo.spec.ts` (unit) / `foo.integration.spec.ts` (integration) / `foo.property.spec.ts` (fast-check).

### Comments
- Comments explain **why**, not what. No narration of the next line. No "step 1, step 2" comments.
- A `// FIXME` or `// TODO` requires an issue link.

### Commits and PRs
- **Conventional Commits.** `feat(cards-svc): ...`, `fix(audit-svc): ...`, `chore(infra): ...`, `docs(spec): ...`, `test(disputes): ...`.
- Breaking changes use `!` and reference the migration note (C1).
- PR titles cite the relevant Task ID(s): `feat(cards-svc): A2 — issuance saga with Stripe Issuing adapter`.

---

## 6. Security and compliance constraints (hard rules)

These rules are blocking. Code that violates any of them must not be merged, regardless of test status.

### 6.1 PAN / CVV / expiry — out of CDE forever

- **Never** persist, log, trace, cache, screenshot, or render through Lumen Cards infrastructure the **PAN**, **CVV**, **full expiry**, **track data**, or **CVC2**. Last-4 digits and the brand are allowed.
- **Never** include those fields in a DTO, even temporarily.
- PAN/CVV reveal is **exclusively** through Stripe Issuing Elements / Stripe.js with a short-lived ephemeral key (A8). The ephemeral key is returned to the client and immediately forgotten by Lumen Cards. The token itself is in the logger denylist.
- If you suspect a leak has occurred (in code, logs, screenshots, error reports): **stop**, open an incident ticket, and follow the `docs/runbooks/suspected-pan-exposure.md` runbook.

### 6.2 Logging denylist

- The `LumenLogger` enforces a structural denylist for fields containing any of: `pan`, `cvv`, `cvc`, `expiry`, `track`, `ephemeralKey`, `secret`, `password`, `sessionId`, `authorization`, `cookie`. Any attempt to log a forbidden key is silently scrubbed and a `logger_denylist_hits_total` counter is incremented.
- **Never** use `console.*`. CI rejects PRs that introduce `console.log/info/warn/error` in `src/**`. Use the logger.
- Request bodies are **never** logged for routes listed in `sensitive-routes.yaml` (reveal, MFA challenge, DSR, dispute evidence upload).

### 6.3 Authentication & authorization

- End-user routes require a valid session cookie (C8). Sensitive actions additionally require a fresh `scaProof` validated by the `@ScaRequired` decorator (B1).
- Internal routes require an authenticated internal session and the RBAC matrix entry permitting the (role × action) pair (B8). Absence of a matrix entry means **DENY**, not "allow because not specified".
- Never compare passwords, secrets, or HMAC outputs with `===`. Use a constant-time comparison.
- Service-to-service calls are **mTLS** with short-lived certificates. Do not introduce shared API-keys between services.

### 6.4 Data privacy & GDPR

- Personal data leaving the service boundary in events is **pseudonymized** unless the topic is in the essential-consumers allow-list (B4). Free-text fields (e.g., `nickname`) are stripped entirely from events.
- An erasure request (B3) redacts personal-data fields on inactive records; audit-log entries are retained per legal obligation with their PII fields redacted via an annotation row (never in-place edit, so the hash chain still verifies).
- Do not introduce a new personal-data field without updating `docs/ropa.md`, `docs/pci-scope.md` (if it touches card data — almost certainly disallowed), and the relevant Avro schema's pseudonymization annotations.

### 6.5 Secrets and keys

- Secrets live in **AWS Secrets Manager** or **Parameter Store**, never in code, never in `.env` files committed to the repo (`.env.example` is allowed).
- KMS customer-managed keys (B5) are referenced by **alias**, never by key ID. Rotation must not break code that pins a version.
- Webhook secrets, partner API keys, and SMS aggregator credentials rotate **quarterly**. The code accepts the prior secret for a 24h grace window during rotation (B6).

### 6.6 Egress and network

- Outbound network calls go through the documented egress proxy. New egress destinations require an `infra/policies/egress-allow-list.yaml` update reviewed by Security.
- Never call third-party APIs directly from `bff-*`. Route through the appropriate domain service.

### 6.7 Compliance documentation co-changes

- Adding or changing any of the following requires a paired update in `docs/`:
  - A processing activity → `docs/ropa.md`.
  - A new sub-processor / vendor → `docs/outsourcing-register.md` (B11).
  - A new KMS key → `docs/key-inventory.md`.
  - A new sensitive route → `sensitive-routes.yaml`.
  - A new RBAC role or action → `permissions.matrix.ts` + PR label `permission-matrix`.

---

## 7. Edge case handling (concrete behaviors)

The bar is **never silently degrade**. Every edge case has a documented, observable outcome.

### 7.1 Card / lifecycle edge cases

| Situation | Expected behavior |
|-----------|-------------------|
| Issue card while user is not `VERIFIED` (KYC) | `403 user.not_eligible`; **do not** contact Stripe. |
| Issue card while user is at the cards cap (default 20) | `409 card.limit_reached`. |
| Issue card succeeds at Stripe but local commit fails | Compensating job reconciles within ≤60s. **Never** issue a second Stripe card on retry — the inbox event handler is the only path that flips `PENDING → ACTIVE`. |
| `Idempotency-Key` reused with a **different** body | `422 idempotency.body_mismatch`. |
| Freeze/unfreeze on a not-yet-active card (`stripe_card_id` null) | `409 card.not_yet_active`. |
| Two operators try to freeze + close concurrently | Optimistic lock wins one; the other gets `409 resource.version_conflict` and **must not** auto-retry. |
| Limit update violates `perTxn ≤ daily ≤ monthly` invariant | `422 limits.invariant_violation` with field-level details. |
| Limit update succeeds at Stripe but local commit fails | Compensating action restores prior Stripe limits; no event emitted. |
| PAN reveal without a fresh `scaProof` | `401 sca.required`. Audit event emitted for the failed attempt. |
| PAN reveal with a `scaProof` older than 120s | `401 sca.stale`. |
| Reuse the same `scaProof.jti` twice | `401 sca.replay_detected`. |
| Reveal on a `FROZEN` / `CLOSED` card | `409 card.not_revealable`. |
| Cross-user access attempt (one user fetches another's `cardId`) | `404 card.not_found` (existence leak avoidance, never `403`). |
| Card replacement: successor issuance fails | Unfreeze the predecessor; surface `502 stripe.upstream_unavailable`. |
| Card replacement: Stripe succeeds, local commit fails | Compensating job closes the successor at Stripe with reason `local_commit_failed`. **No orphan Stripe card may remain active.** |
| Authorization or capture arrives after card closure | Record with tag `post_closure = true`; the projector still processes it; user can see it in the txn list. |

### 7.2 Transactions / webhooks

| Situation | Expected behavior |
|-----------|-------------------|
| Duplicate Stripe webhook (same `event.id`) | Inbox dedupes by unique constraint; one projection effect. |
| Webhook signature fails | `401`. Increment `stripe_webhook_signature_failures_total`. Audit event emitted. **Never log the body.** |
| Webhook timestamp outside 5-min tolerance | `401`. Same telemetry as signature failure. |
| Webhooks arrive out of order (capture before authorization) | Projector upserts and reconciles on the later event. Final state is deterministic. |
| Webhook references unknown `stripe_card_id` | Recorded in inbox, marked `IGNORED`. No projection. No alert. |
| Replay > 30 days old | Accepted but tagged `late_replay = true` in the audit event. |

### 7.3 Disputes

| Situation | Expected behavior |
|-----------|-------------------|
| Open dispute on an authorized-but-not-captured txn | `409 dispute.not_yet_disputable`. |
| Open dispute on a foreign txn | `404 transaction.not_found`. |
| Evidence file > 5 MB or wrong MIME | `413 body.too_large` or `415 media.unsupported`. |
| Stripe rejects a dispute (past window) | Local row → `LOST` with `closed_at`; reason in audit event. |

### 7.4 Internal / RBAC

| Situation | Expected behavior |
|-----------|-------------------|
| `SUPPORT` calls a `CLOSE` route | `403 rbac.forbidden`. |
| Internal user has multiple roles | Effective permissions = **union**. Audit event records all active roles. |
| Spoofed role header on internal request | Rejected at the BFF auth middleware; upstream identity claim is the only source of truth. |
| Internal user attempts a user-only action (e.g., reveal) | `403 rbac.forbidden`. **No impersonation.** |

### 7.5 Infrastructure / dependencies

| Situation | Expected behavior |
|-----------|-------------------|
| Stripe Issuing returns 5xx | `502 stripe.upstream_unavailable`. Circuit breaker may open. **Never** mark a card `ACTIVE` based on optimistic local state. |
| Stripe sustained outage > 5 minutes | Health probe (B11) pages on-call. `/readyz` flips. The auth path stays read-functional. |
| Kafka unavailable | Outbox publisher backs off; `outbox_unpublished_count` grows; on-call paged at 5 minutes. **Do not** drop events. |
| Redis unavailable | Read routes **fail open**; sensitive routes (reveal, replace) **fail closed** with `503`. |
| PostgreSQL primary failover | Replicas promote; in-flight transactions may fail with `5xx`; clients retry idempotently. |
| Clock skew > 60s | Treat SCA proofs as stale. Treat Stripe timestamps as suspicious; tag the audit event. |

### 7.6 When the agent is unsure

If a task hits an edge case **not** listed above and **not** covered by a specification Task: **stop and ask**. Acceptable: propose a behavior in the PR description with a rationale and label the PR `needs-ops-review`. Unacceptable: silent guess, swallowed exception, `console.log` debug, or removing a test to make CI green.

---

## 8. Idempotency, audit, events — cross-cutting expectations

Every non-trivial change touches all three.

1. **Idempotency (C5).** Every non-GET handler accepts and persists `Idempotency-Key`. The middleware is the only path; never reimplement it inline.
2. **Audit (B2).** Every business state change and every internal admin action emits an audit event in the same DB transaction (outbox to `audit-svc`). The event includes `actor, action, target, before/after, correlationId, timestamp`.
3. **Domain events (A13).** Every state change emits a versioned event to Kafka via the **transactional outbox**. Topic naming: `lumen.<context>.<entity>.<event>.v<n>`. Partition key: aggregate id. Consumers dedupe by `eventId`.

Checklist before merging a state-changing change:
- [ ] Idempotency-Key required and validated.
- [ ] Audit event present in the same transaction.
- [ ] Domain event present in the outbox.
- [ ] Correlation-id propagated (C6).
- [ ] Optimistic version check applied.
- [ ] Error envelope (C2) wraps every failure path.

---

## 9. Performance and reliability expectations

These are not aspirational. They are gating targets (Part B, B9; Part D, D7).

- **Authorization path SLO:** 99.95% monthly. p95 projection lag (webhook in → user-visible) ≤ **2 s**, p99 ≤ **5 s**, sustained at ~500 auth/sec.
- **User API SLO:** 99.9% monthly. Mutating routes p95 ≤ **800 ms**, p99 ≤ **1.5 s**. Read routes p95 ≤ **150 ms**.
- **Audit append SLO:** 99.99%. No `audit_lost` events permitted per quarter.

When writing code:
- Add a single index for every new query pattern. Document it in the PR description.
- Avoid N+1 in handlers; batch via repository methods.
- Pagination is mandatory for any list endpoint that can return > 100 rows (C4).
- A handler that performs > 2 outbound calls (Stripe, downstream service, S3) is a code smell — split it or fold into a saga (e.g., A2, A9).

---

## 10. Testing and verification expectations

These mirror Part D but are restated as hard rules.

### 10.1 Categories

Every non-trivial PR must include at least:

| Category | When required | Tool |
|----------|---------------|------|
| **Unit** | Always for new domain logic | Jest + ts-jest |
| **Integration** | DB/Kafka/Redis/Stripe touch | Jest + Testcontainers + Stripe sandbox harness (D3) |
| **Contract** | OpenAPI/DTO change | D4 runner |
| **Property-based** | FSM, pagination, idempotency, monetary math | fast-check (D5) |
| **Security** | New route, new role, new SCA gate, new log call site | D8 specs |
| **Compliance** | Audit, GDPR, retention surfaces | D9 specs |
| **Performance** | Hot path change | k6 scenario (D7), nightly |
| **E2E** | New user-visible flow | D6 scenarios |

### 10.2 Coverage gates

- Domain layers (`cards-svc`, `disputes-svc`, `audit-svc`) — **≥ 85% line / 90% branch**.
- Libraries (`libs/contracts`, `libs/events`) — **≥ 90% / 95%**.
- BFFs — **≥ 70% / 75%** (logic is thin by design).
- A PR may not lower coverage on a touched file below threshold.

### 10.3 Determinism

- Time: use `injectedClock.now()` not `Date.now()`. Tests freeze with the shim from D1.
- Randomness: inject `Random`. Never call `Math.random()` directly.
- ULIDs: use the seeded generator in tests; never assert on freshly-generated ids.
- Network: integration tests use Testcontainers + recorded Stripe fixtures (D3). No live external calls in CI except the nightly `@stripe-sandbox` job.

### 10.4 What "verified" means

A handler/feature is verified when, in addition to passing tests:

- The OpenAPI fragment matches the controller (C3 drift gate green).
- The audit event payload is asserted with a snapshot test.
- The error envelope is asserted for each failure-mode `error.code`.
- A property test exists for every documented invariant in the matching specification Task.
- The performance budget from the Task is referenced in a k6 scenario (or marked `N/A` with rationale).

### 10.5 Forbidden in tests

- Skipped tests (`it.skip`, `xdescribe`, `describe.skip`) in committed code. Use a tracking issue + delete the test if it should not run yet.
- Sleeping with magic numbers (`setTimeout(..., 1000)`). Use deterministic waits on observable conditions.
- Real PII (real user emails, real PANs, real phone numbers). All test data is synthetic.
- Snapshot tests that include `correlationId`, ULIDs, or timestamps without redaction.

---

## 11. Definition of Done (per PR)

A PR is mergeable when **every** item below is true. The agent should self-check before requesting review.

- [ ] Title cites the Task ID (e.g., `A2`, `B1`, `C5`).
- [ ] No `console.*`, no `any`, no `@ts-ignore` without justification.
- [ ] No banned key (§6.2) in any logger call or response body.
- [ ] OpenAPI fragment updated; C3 drift gate green.
- [ ] DTOs validated in whitelist mode; unknown fields rejected.
- [ ] `Idempotency-Key` required and enforced on non-GET routes.
- [ ] Audit event emitted in the same transaction as the state change.
- [ ] Domain event emitted via the transactional outbox.
- [ ] Error envelope used; every new `error.code` registered in `docs/error-codes.md`.
- [ ] `correlationId` propagated end-to-end (request, log, audit, event).
- [ ] RBAC matrix updated and tested (if internal route).
- [ ] SCA gate applied via `@ScaRequired` (if sensitive route).
- [ ] Tests per §10 added or updated.
- [ ] Coverage thresholds unchanged or improved.
- [ ] Performance budget referenced in PR description; k6 scenario updated if hot-path.
- [ ] Compliance documentation co-change (§6.7) committed in the same PR if applicable.
- [ ] Migration script added if the change is schema-affecting; rollback documented.
- [ ] Reviewer hint: name the runbook(s) affected, if any.

---

## 12. Clarification protocol

The agent should ask, not guess, in any of the following cases:

1. The task spans **more than one** Task ID without a clear primary.
2. The task introduces a new processing activity (GDPR), a new sub-processor, a new role, a new sensitive route, or a new egress destination.
3. The task implies storing or rendering a field that could be card data (PAN, CVV, expiry, track data) — **always escalate**, never proceed.
4. The task changes the public REST contract in a way that may be breaking under C1.
5. A test would have to be skipped or weakened to make the change pass.
6. The performance budget in the relevant Task cannot be met without an architectural change.

When asking, frame the question as: *"To complete Task `<ID>`, I need a decision on `<X>`. Option A: `<...>` (trade-off `<...>`). Option B: `<...>` (trade-off `<...>`). My recommendation: `<A or B>` because `<...>`."* — never an open-ended "what should I do?".

---

## 13. Forbidden behaviors (summary)

- Storing or logging PAN, CVV, expiry, track data, magstripe, or CVC2 — anywhere, ever.
- Bypassing the FSM with raw `UPDATE`.
- Bypassing the idempotency middleware with handler-local maps.
- Skipping audit on a state change.
- Calling Stripe (or any third party) directly from `bff-*`.
- Cross-region resource creation outside EU.
- Generating, persisting, or accepting a non-ULID id for an entity.
- Floating-point arithmetic on monetary amounts.
- Returning `403` when `404` is the existence-leak-safe answer.
- Silent retry on `409 resource.version_conflict`.
- Using `console.*` or unstructured loggers.
- Adding a dependency without a PR-description justification and approval.
- Committing secrets, real PANs, or real user data — including in tests, fixtures, screenshots, or commit messages.

---

## 14. Glossary (for the agent's prompts)

- **CDE** — Cardholder Data Environment (PCI DSS scope boundary).
- **DPA** — Data Processing Agreement (GDPR).
- **DSR** — Data Subject Request (GDPR rights).
- **FSM** — Finite State Machine (card lifecycle in A1).
- **JIT** — Just-In-Time (PAN reveal flow, A8).
- **MFA / SCA** — Multi-Factor Authentication / Strong Customer Authentication (PSD2, C8 + B1).
- **MCC** — Merchant Category Code (out of scope in MVP per Part A scope).
- **PAN** — Primary Account Number (forbidden to store).
- **PCI DSS** — Payment Card Industry Data Security Standard.
- **PSD2** — EU Revised Payment Services Directive.
- **RBAC** — Role-Based Access Control (B8).
- **RoPA** — Record of Processing Activities (GDPR).
- **SLO** — Service Level Objective.

---

> **Last word.** When in doubt, prefer **fewer, smaller, audited, idempotent** changes over **clever, optimistic, faster** ones. In a regulated environment, "observably correct" beats "elegant".
