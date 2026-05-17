# Lumen Cards — Virtual Card Lifecycle Specification

> **Document status:** Draft v0.1 — Parts A and B only. Subsequent parts (API spec, testing spec, cross-cutting edge-case table, verification matrix, performance budgets) will be appended after reviewer approval.
>
> **Reading order:** Part A frames the product mechanics using the *Basic Specification* template. Part B re-frames the same product through a *Banking-Specific Specification* lens, layering compliance, security, audit, and non-functional guardrails. The two parts are complementary and intentionally non-redundant: Part A names the **what**, Part B constrains the **how it must be done in a regulated environment**.
>
> **Audience:** Engineering team (NestJS / Node 20), Ops & Compliance reviewers, and an AI coding partner consuming this file alongside `agents.md` and the editor rules in `.cursor/rules/`.
>
> **Single source of truth:** This file. Any rule, target, or convention stated here overrides ad-hoc decisions made later in implementation.

---

## Product Context (shared by Part A and Part B)

- **Product name:** Lumen Cards.
- **Product shape:** Neobank-style virtual card lifecycle platform. End-users hold one shared EUR wallet and can issue multiple virtual cards against it, each with its own controls and limits.
- **Card issuer-processor:** Stripe Issuing (BIN sponsor). Lumen Cards is intentionally **out-of-CDE**: PAN and CVV are never stored, logged, or rendered through our infrastructure.
- **Stakeholders / actors:**
  - **End-user** (mobile + web) — owns the wallet and cards.
  - **Internal Ops / Compliance** — back-office UI for investigations, supervised actions, regulatory reporting hand-offs.
  - **Customer Support agent** — read-mostly console with masked data.
  - **Fraud analyst** — case console; can freeze/close cards and annotate cases.
- **Regulatory frame:** EU/EEA — PSD2 (SCA), GDPR, PCI DSS (Lumen Cards stays out-of-CDE by design), EBA Guidelines on outsourcing arrangements (EBA/GL/2019/02).
- **Out of scope:** KYC, AML transaction monitoring, core ledger / treasury, physical cards, rewards, statements & tax documents. These are sibling/upstream systems; Lumen Cards consumes a verified-user precondition and emits domain events that downstream systems may subscribe to.
- **Tech baseline:** Node.js 20 LTS, NestJS 10, PostgreSQL 16, Redis 7, Apache Kafka (transactional outbox), AWS `eu-west-1` (primary) + `eu-central-1` (warm DR). All workloads deployed inside the EU; no cross-border transfer of personal data.

---

# Part A — Basic Specification Template (Lumen Cards, Product-Mechanics Lens)

> Ingest the information from this file, implement the Low-Level Tasks, and generate the code that will satisfy the High and Mid-Level Objectives.

## High-Level Objective

- Deliver an end-to-end **virtual card lifecycle service** that lets a verified Lumen Cards end-user issue, control, observe, and retire virtual EUR cards backed by Stripe Issuing — with parity-grade back-office tooling for Ops, Support, and Fraud — while keeping the platform fully out of the PCI cardholder data environment.

## Mid-Level Objectives

1. **Card issuance is self-service and idempotent.** A verified end-user can request a new virtual card and receive a usable, tokenized card reference within seconds; duplicate requests with the same `Idempotency-Key` never produce two cards.
2. **Lifecycle state transitions are explicit, observable, and reversible only where business rules allow.** `ACTIVE → FROZEN → ACTIVE`, `ACTIVE → CLOSED` and `ACTIVE → REPLACED → CLOSED(predecessor)` are the only legal paths; every transition is auditable and emits a domain event.
4. **Spending limits and freeze state are enforced at the processor layer, not just our DB.** Limit and freeze changes propagate to Stripe Issuing before the user-facing response returns success; otherwise the change is rolled back.
5. **Transactions are queryable per card and per wallet with stable, paginated reads.** Users, Support, and Fraud can list authorizations and captured transactions with consistent ordering and bounded latency, regardless of dataset size.
6. **Sensitive card data is revealed only through Stripe-hosted UI components after SCA step-up.** PAN/CVV never traverses Lumen Cards servers, logs, screenshots, or analytics.
7. **Disputes can be raised, tracked, and reconciled with Stripe Issuing.** A user can raise a dispute on a captured transaction, upload evidence, and observe status changes mirrored from the processor.
8. **Card replacement preserves wallet continuity.** A compromised card can be replaced in one operation that closes the predecessor, issues a successor, and links them via an audit-trail relationship without re-onboarding the user.
9. **Internal actors see exactly what their role allows.** Ops can supervise, Support can read masked data and trigger limited remediations, Fraud can freeze and annotate — none of them can perform user-only actions (e.g., PAN reveal) on behalf of a user.
10. **The system is observably healthy.** Each bounded context exposes liveness, readiness, and domain-specific health (e.g., Stripe Issuing connectivity, Kafka outbox lag).

## Implementation Notes

- **Language / framework:** Node.js 20 LTS, NestJS 10, TypeScript with `strict: true`, ESLint + Prettier with `@typescript-eslint/recommended-type-checked`. No `any` in production code; introduce branded types for `CardId`, `WalletId`, `UserId`, `StripeCardId`, `TransactionId`.
- **Bounded contexts → services:**
  - `cards-svc` (issuance, lifecycle state machine, controls/limits)
  - `transactions-svc` (authorizations & captures projection from Stripe Issuing webhooks)
  - `disputes-svc` (intake, evidence storage references, status mirror)
  - `notifications-svc` (push / email / SMS fan-out)
  - `audit-svc` (append-only audit log, retention-aware)
  - `bff-user` and `bff-internal` (NestJS BFFs for end-user and internal consoles, respectively)
- **Inter-service communication:** Synchronous over HTTP/2 + JSON for query paths; asynchronous via Kafka with the **transactional outbox** pattern for state-change events. Each service owns its DB schema; no cross-service joins.
- **IDs and formats:**
  - All public IDs are ULIDs prefixed by entity (`card_01H...`, `txn_01H...`, `dsp_01H...`). Stripe-side IDs are stored as opaque strings on the boundary entity only.
  - Monetary amounts are integer **minor units** (`cents`) plus a 3-letter ISO 4217 currency code; never floats. The only supported currency in MVP is `EUR`.
  - Timestamps are stored as `TIMESTAMPTZ` in UTC; API surface uses RFC 3339 with `Z` suffix.
- **Idempotency:** All non-GET endpoints require an `Idempotency-Key` header (UUIDv4 or ULID, ≤128 chars). Keys are persisted with the request hash and the resulting response for **24 hours**; replays in that window return the original response verbatim.
- **State machine for cards:** A finite-state machine in `cards-svc` with states `PENDING → ACTIVE`, `ACTIVE ↔ FROZEN`, `ACTIVE/FROZEN → CLOSED`, and a synthetic `REPLACED` marker on the predecessor when reissued. Illegal transitions return `409 Conflict` with a stable `error.code = card.illegal_transition`.
- **Concurrency:** Optimistic locking via a monotonically increasing `version` column on `cards` and `wallets`; conflicting updates surface as `409 Conflict` with `error.code = resource.version_conflict`. Long-running operations against Stripe use the **saga** pattern with compensating actions on failure.
- **Error semantics:** A single error envelope `{ error: { code, message, correlationId, retryable } }`. `correlationId` (ULID) is propagated through the `X-Correlation-Id` header, the logger, and every emitted event.
- **Webhook ingestion:** Stripe webhooks are signature-verified, deduplicated by Stripe `event.id`, and persisted before any business logic runs (write-ahead inbox). Processing is asynchronous and at-least-once; handlers must be idempotent.
- **Forbidden:** Storing or logging PAN, CVV, expiry, magnetic stripe data, or any data that would expand PCI DSS scope. Forbidden even in temporary variables and DTOs in NestJS controllers.

## Context

### Beginning context

The following are assumed to exist before any work on Lumen Cards starts:

- A monorepo at the workspace root with the following empty / placeholder folders:
  - `services/cards-svc/` (empty NestJS skeleton scaffolded via `nest new`)
  - `services/transactions-svc/`
  - `services/disputes-svc/`
  - `services/notifications-svc/`
  - `services/audit-svc/`
  - `services/bff-user/` and `services/bff-internal/`
  - `libs/contracts/` (shared TS types and OpenAPI specs)
  - `libs/events/` (Kafka topic schemas — Avro)
  - `infra/` (Terraform skeleton; AWS accounts already created in `eu-west-1` and `eu-central-1`)
- Existing upstream / sibling systems available over signed, mTLS-protected internal APIs:
  - `identity-svc` — provides authenticated session info, MFA state, and a `kycStatus = VERIFIED` precondition.
  - `wallet-svc` — provides the user's single EUR wallet (`walletId`, `availableBalanceMinor`), funds reservation, and settlement.
  - `risk-svc` — accepts events and may asynchronously instruct Lumen Cards to freeze a card (out of scope to design; respected as an inbound command).
- A configured Stripe Issuing test environment with EU BIN sponsorship; webhook endpoints not yet wired.
- An empty Kafka cluster with topic-creation policy: `lumen.<context>.<entity>.<event>.v<n>` (e.g., `lumen.cards.card.created.v1`).
- A baseline `agents.md` and `.cursor/rules/` describing FinTech-sensitive defaults (no PAN logging, idempotent writes, monetary `Decimal`/minor units).

### Ending context

When Part A is fully implemented, the following must exist:

- Running services `cards-svc`, `transactions-svc`, `disputes-svc`, `notifications-svc`, `audit-svc`, `bff-user`, `bff-internal` — each with `/healthz`, `/readyz`, structured JSON logs, and OpenTelemetry traces.
- `libs/contracts/` containing:
  - OpenAPI 3.1 documents for `bff-user` and `bff-internal`.
  - Branded-type TypeScript definitions for all public IDs.
- `libs/events/` containing Avro schemas for at least:
  - `card.created.v1`, `card.frozen.v1`, `card.unfrozen.v1`, `card.closed.v1`, `card.replaced.v1`
  - `card.limits_updated.v1`
  - `transaction.authorized.v1`, `transaction.captured.v1`, `transaction.refunded.v1`
  - `dispute.opened.v1`, `dispute.status_changed.v1`
- A migrated PostgreSQL schema per service (Flyway / `node-pg-migrate`) with the entities described in the Low-Level Tasks below.
- A Stripe Issuing webhook receiver in `transactions-svc` with verified signatures, an inbox table, and idempotent handlers.
- An end-to-end happy-path flow exercised in a docker-compose dev environment: create card → set limits → freeze → unfreeze → authorize (simulated) → view txn → raise dispute → replace card → close card.

## Low-Level Tasks (Part A)

> Each task uses the **extended** format: Prompt / File / Function / Details, followed by **Acceptance Criteria**, **Edge Cases**, **Verification**, and **Performance**. Tasks are grouped by bounded context. Numbering is global so cross-references in Part B remain unambiguous.

### A1. Card domain model and FSM in `cards-svc`

**What prompt would you run to complete this task?**
"Create the `Card` aggregate, its persistence schema, and a finite-state machine for legal lifecycle transitions in `cards-svc`. The aggregate must own state, limits, and a version number for optimistic locking, but must never contain PAN, CVV, or expiry."

**What file do you want to CREATE or UPDATE?**
- `services/cards-svc/src/domain/card.entity.ts`
- `services/cards-svc/src/domain/card.fsm.ts`
- `services/cards-svc/src/infra/persistence/card.repository.ts`
- `services/cards-svc/migrations/0001_create_cards.sql`

**What function do you want to CREATE or UPDATE?**
- `class Card` (aggregate root) with methods `freeze()`, `unfreeze()`, `close(reason)`, `markReplaced(successorId)`, `applyLimits(limits)`.
- `function transition(current: CardState, event: CardEvent): CardState`.

**What are details you want to add to drive the code changes?**
- States: `PENDING`, `ACTIVE`, `FROZEN`, `CLOSED`, plus a `REPLACED` boolean marker on closed predecessors.
- The `cards` table columns: `id ULID PK`, `wallet_id ULID FK`, `user_id ULID`, `stripe_card_id TEXT UNIQUE`, `state TEXT NOT NULL`, `nickname TEXT`, `last4 TEXT NOT NULL`, `brand TEXT NOT NULL`, `currency CHAR(3) NOT NULL DEFAULT 'EUR'`, `per_txn_limit_minor BIGINT`, `daily_limit_minor BIGINT`, `monthly_limit_minor BIGINT`, `predecessor_card_id ULID NULL`, `successor_card_id ULID NULL`, `closed_reason TEXT NULL`, `version INT NOT NULL DEFAULT 0`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `closed_at TIMESTAMPTZ NULL`. Constraints: `CHECK (currency = 'EUR')`, `CHECK (last4 ~ '^[0-9]{4}$')`, unique partial index on `(stripe_card_id)`.
- The aggregate must reject illegal transitions by throwing `IllegalCardTransitionError`; the FSM must be table-driven and exported as a pure function for unit tests.

**Acceptance Criteria**
- Loading a card, calling `freeze()`, persisting, and reloading shows `state = FROZEN` and `version` incremented by 1.
- Calling `close('LOST')` on an already `CLOSED` card throws `IllegalCardTransitionError` and the DB row is unchanged.
- `last4`, `brand`, and `stripe_card_id` are the only Stripe-derived fields persisted; no PAN/CVV/expiry columns exist.

**Edge Cases**
- Concurrent freeze + close on the same card (two operators, two requests in flight): exactly one succeeds; the other returns `409 resource.version_conflict`.
- Replay of an already-applied state transition through the outbox does **not** mutate the row again.
- A card whose `stripe_card_id` is null (issuance in flight) cannot accept `freeze`/`unfreeze`/`limits` operations — they return `409 card.not_yet_active`.

**Verification**
- Unit tests for the FSM table cover all 16 (state × event) cells, asserting legal targets and explicit rejection on illegal pairs.
- Integration test against a real PostgreSQL container exercises the optimistic-lock path with two concurrent transactions.
- Migration is applied and rolled back cleanly in CI.

**Performance**
- `cardRepository.findById()` p95 ≤ **15 ms** in service-local benchmark (warm cache, indexed PK).
- FSM transition function pure CPU; p99 ≤ **50 µs** for any input.

---

### A2. Card issuance endpoint and Stripe Issuing adapter

**What prompt would you run to complete this task?**
"Implement `POST /v1/cards` in `bff-user` and the issuance saga in `cards-svc` that creates a Stripe Issuing card, persists the boundary entity, and emits `card.created.v1`. Enforce idempotency and never log PAN."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/cards/cards.controller.ts`
- `services/cards-svc/src/application/issue-card.handler.ts`
- `services/cards-svc/src/infra/stripe/stripe-issuing.adapter.ts`
- `services/cards-svc/src/infra/outbox/outbox.repository.ts`
- `libs/contracts/openapi/bff-user.yaml`

**What function do you want to CREATE or UPDATE?**
- `CardsController.create(body, idempotencyKey, sessionUser)`.
- `IssueCardHandler.handle(command: IssueCardCommand)`.
- `StripeIssuingAdapter.createCard(args)` returning `{ stripeCardId, last4, brand }`.

**What are details you want to add to drive the code changes?**
- Request body (validated via `class-validator`): `{ nickname?: string (≤32, printable ASCII), perTxnLimitMinor?: int ≥ 100, dailyLimitMinor?: int, monthlyLimitMinor?: int }`. All limits are optional; absence means "no per-card limit" (wallet limits still apply).
- Saga steps: (1) reserve a card slot row in `cards` with state `PENDING` and the version 0; (2) call Stripe Issuing `cards.create` with `metadata = { lumenCardId, userId }`; (3) on success, atomically update the row to `ACTIVE` with `stripe_card_id`, `last4`, `brand`, `updated_at`; (4) write `card.created.v1` to the outbox in the same transaction; (5) on Stripe failure, mark the row `CLOSED` with `closed_reason = 'ISSUANCE_FAILED'` and emit no `card.created` event.
- Idempotency: persist `(idempotencyKey, userId) → response` for 24 h; replays return the same response and do **not** call Stripe again.
- Logging: log `cardId`, `userId`, `correlationId`, `stripeCardId`. Never log request body, nickname, last4 at `DEBUG` or above.

**Acceptance Criteria**
- A successful call returns `201 Created` with body `{ id, state: 'ACTIVE', last4, brand, currency: 'EUR', limits, createdAt }` and the `card.created.v1` event is published.
- Replaying with the same `Idempotency-Key` within 24 h returns the **same** `id` and body, with **no** additional Stripe call.
- If Stripe Issuing returns 5xx, the API responds `502 stripe.upstream_unavailable`, the placeholder row is marked `CLOSED/ISSUANCE_FAILED`, and no `card.created` event is emitted.

**Edge Cases**
- User is not verified (`kycStatus ≠ VERIFIED`): respond `403 user.not_eligible` without contacting Stripe.
- User already has the **maximum allowed** active cards (configurable, default 20): respond `409 card.limit_reached`.
- Stripe call succeeds but the local `ACTIVE` update fails (rare): a compensating job marks the row `ACTIVE` from the inbox event within ≤ 60 s; no duplicate card is issued on retry.
- Idempotency-Key reused with a **different** request body within the window: respond `422 idempotency.body_mismatch`.

**Verification**
- Integration test against a Stripe Issuing sandbox confirms the happy path and the body-mismatch behavior.
- Contract test asserts the OpenAPI schema matches the controller's response.
- A unit test asserts no logger call receives `pan`, `cvv`, or `expiry` keys (use a logger spy + denylist).

**Performance**
- p95 end-to-end latency ≤ **800 ms** when Stripe sandbox latency ≤ 400 ms; p99 ≤ **1.5 s**.
- Concurrency: at least **50 issuances/second per pod**; no card-row contention because PK is ULID.

---

### A3. Freeze / unfreeze operations

**What prompt would you run to complete this task?**
"Implement `POST /v1/cards/{cardId}/freeze` and `POST /v1/cards/{cardId}/unfreeze`. Propagate the change to Stripe Issuing before returning success. Emit `card.frozen.v1` / `card.unfrozen.v1`."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/cards/cards.controller.ts`
- `services/cards-svc/src/application/freeze-card.handler.ts`
- `services/cards-svc/src/application/unfreeze-card.handler.ts`

**What function do you want to CREATE or UPDATE?**
- `CardsController.freeze(cardId, idempotencyKey, sessionUser)`
- `FreezeCardHandler.handle(cmd)` / `UnfreezeCardHandler.handle(cmd)`.

**What are details you want to add to drive the code changes?**
- The handler loads the card, asserts ownership (`card.userId === session.userId`), and applies the FSM transition.
- Calls `StripeIssuingAdapter.updateCardStatus(stripeCardId, status)` where `status ∈ {'inactive','active'}` for freeze/unfreeze. On Stripe error, the local transaction is **rolled back** and `502 stripe.upstream_unavailable` is returned.
- Emits the matching event to the outbox in the same transaction.

**Acceptance Criteria**
- Freezing an `ACTIVE` card returns `200 OK` with the updated card; subsequent authorization simulations are declined by Stripe.
- Unfreezing a `FROZEN` card returns `200 OK`; subsequent authorization simulations are allowed.
- Freezing a `CLOSED` card returns `409 card.illegal_transition`.

**Edge Cases**
- Double-freeze (idempotent): if the card is already `FROZEN` and the same `Idempotency-Key` is replayed, return the cached `200`. With a **new** key but identical intent, return `200` with the current row (no event re-emitted).
- Fraud-initiated freeze while user requests unfreeze concurrently: optimistic-lock guarantees one wins; the loser sees `409 resource.version_conflict` and the UI is expected to refresh state.

**Verification**
- Integration test: freeze → simulate auth via Stripe test helper → assert decline → unfreeze → simulate auth → assert approval.
- Event-publication test asserts a single `card.frozen.v1` is emitted per real state change.

**Performance**
- p95 ≤ **500 ms** end-to-end; p99 ≤ **900 ms**, dominated by Stripe RTT.

---

### A4. Set / update spending limits

**What prompt would you run to complete this task?**
"Implement `PATCH /v1/cards/{cardId}/limits` to update per-transaction, daily, and monthly limits. Validate ranges, persist locally, push to Stripe Issuing as spending controls, and emit `card.limits_updated.v1`."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/cards/cards.controller.ts`
- `services/cards-svc/src/application/update-limits.handler.ts`
- `services/cards-svc/src/infra/stripe/stripe-issuing.adapter.ts`

**What function do you want to CREATE or UPDATE?**
- `CardsController.updateLimits(cardId, body, idempotencyKey, sessionUser)`
- `UpdateLimitsHandler.handle(cmd)`
- `StripeIssuingAdapter.updateSpendingControls(stripeCardId, controls)`

**What are details you want to add to drive the code changes?**
- Body: any subset of `{ perTxnLimitMinor, dailyLimitMinor, monthlyLimitMinor }`. Each is `int >= 100` (€1.00) and `<= 50_000_00` (€50,000). To **clear** a limit, the client sends `null` explicitly.
- Range invariants: `perTxnLimitMinor ≤ dailyLimitMinor ≤ monthlyLimitMinor` where all three are non-null. Violations → `422 limits.invariant_violation`.
- Stripe mapping: `perTxnLimitMinor → spending_controls.spending_limits[interval=per_authorization]`, `daily → daily`, `monthly → monthly`.

**Acceptance Criteria**
- A successful update reflects in both PostgreSQL and Stripe; reading the card afterward returns the new values; the event is on the outbox.
- Sending `{ perTxnLimitMinor: null }` clears the per-txn limit both locally and at Stripe.
- Invariant violations return `422` with a clear `error.code` and field-level details.

**Edge Cases**
- Client sends limits in floats (e.g., `12.50`): rejected at the validator (`@IsInt()`); never coerced.
- Stripe accepts the update but the local commit fails: compensating action restores the prior limits at Stripe; emit nothing.
- Currency mismatch (client tries to send a `currency` field): rejected; MVP only supports EUR and `currency` is not accepted on this endpoint.

**Verification**
- Unit tests exhaustively cover invariant combinations including all-null, partial-null, and boundary values (`100`, `50_000_00`).
- Integration test verifies the Stripe spending-controls object after update.

**Performance**
- p95 ≤ **600 ms**.

---

### A5. List & detail endpoints for cards

**What prompt would you run to complete this task?**
"Implement `GET /v1/cards` (list user's cards with cursor pagination) and `GET /v1/cards/{cardId}` (detail). Return only non-sensitive fields. Support filtering by `state` and `nicknameContains`."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/cards/cards.controller.ts`
- `services/cards-svc/src/application/list-cards.query.ts`
- `services/cards-svc/src/application/get-card.query.ts`

**What function do you want to CREATE or UPDATE?**
- `CardsController.list(query, sessionUser)` and `CardsController.getById(cardId, sessionUser)`.

**What are details you want to add to drive the code changes?**
- Cursor pagination: `?limit=20&cursor=<opaque>` where cursor encodes `(created_at, id)`. `limit` max 100, default 20.
- Ordering: `created_at DESC, id DESC` (stable, ULID tiebreaker).
- Detail response includes `id, state, nickname, last4, brand, currency, limits, createdAt, updatedAt, closedAt, predecessorCardId, successorCardId`. **Never** PAN, CVV, expiry.

**Acceptance Criteria**
- A user with 25 cards paginates through them in two pages with no duplicates or gaps when no concurrent writes occur.
- A second user cannot retrieve another user's card (`404 card.not_found`, not `403`, to avoid existence leaks).

**Edge Cases**
- Card is created during pagination: the new card may or may not appear; ordering and absence of duplicates are guaranteed.
- Cursor is malformed: `400 pagination.invalid_cursor`.

**Verification**
- Property-based test asserts pagination stability across random insertions.
- Snapshot test asserts the response schema matches the OpenAPI document.

**Performance**
- p95 list ≤ **120 ms** for ≤ 100 results; p95 detail ≤ **40 ms**. Backed by index on `(user_id, created_at DESC, id DESC)`.

---

### A6. Transactions projection from Stripe Issuing webhooks

**What prompt would you run to complete this task?**
"Implement a webhook receiver in `transactions-svc` that ingests `issuing_authorization.*` and `issuing_transaction.*` events into an inbox table, then projects them into a per-card transactions read model."

**What file do you want to CREATE or UPDATE?**
- `services/transactions-svc/src/webhooks/stripe.controller.ts`
- `services/transactions-svc/src/projection/transactions.projector.ts`
- `services/transactions-svc/migrations/0001_create_transactions.sql`

**What function do you want to CREATE or UPDATE?**
- `StripeWebhookController.receive(rawBody, signature)`.
- `TransactionsProjector.apply(event)`.

**What are details you want to add to drive the code changes?**
- Verify Stripe signature using the raw request body; reject `401` on mismatch and never log the body.
- Inbox table `stripe_inbox(event_id PK, type, payload JSONB, received_at, processed_at NULL, attempts INT DEFAULT 0)`.
- Read model `transactions(id ULID PK, card_id ULID FK, user_id ULID, stripe_object_id TEXT UNIQUE, status TEXT, amount_minor BIGINT, currency CHAR(3), merchant_name TEXT, merchant_category TEXT, occurred_at TIMESTAMPTZ, projected_at TIMESTAMPTZ)`.
- Status values: `AUTHORIZED`, `CAPTURED`, `REVERSED`, `REFUNDED`, `DECLINED`.

**Acceptance Criteria**
- A duplicate webhook (same `event.id`) is recorded once in the inbox and projected once into the read model.
- The transaction is queryable via `GET /v1/cards/{cardId}/transactions` ≤ **2 s** after Stripe emits the event (p95).
- Webhook signature failures return `401` and increment a Prometheus counter `stripe_webhook_signature_failures_total`.

**Edge Cases**
- Webhooks arrive out of order (capture before authorization): the projector tolerates this by upserting and reconciling on the later event.
- Webhook payload references an unknown `stripe_card_id` (e.g., test event for a foreign card): record in inbox with `processed_at = received_at` and `status = 'IGNORED'`, no projection.
- Replay older than 30 days: accepted (we are a system of record for our own copy), but tagged `late_replay = true` in the audit event.

**Verification**
- Integration test uses Stripe's `events.create` for fixture events and asserts projection outcomes.
- Chaos test: shuffle event order across 1,000 simulated transactions, assert final state is deterministic and matches Stripe's view.

**Performance**
- Sustained webhook throughput **≥ 200 events/second per pod**; projection lag p95 **≤ 2 s**; p99 **≤ 5 s**.

---

### A7. Transactions list & filter endpoint

**What prompt would you run to complete this task?**
"Implement `GET /v1/cards/{cardId}/transactions` and `GET /v1/wallet/transactions` with cursor pagination and filtering by date range, status, and amount range."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/transactions/transactions.controller.ts`
- `services/transactions-svc/src/application/list-transactions.query.ts`

**What function do you want to CREATE or UPDATE?**
- `TransactionsController.listForCard(cardId, query, sessionUser)`
- `TransactionsController.listForWallet(query, sessionUser)`

**What are details you want to add to drive the code changes?**
- Query params: `from`, `to` (RFC 3339), `status` (multi), `minAmountMinor`, `maxAmountMinor`, `cursor`, `limit` (≤100, default 20).
- Ordering: `occurred_at DESC, id DESC`. Index on `(card_id, occurred_at DESC, id DESC)` and `(user_id, occurred_at DESC, id DESC)`.

**Acceptance Criteria**
- All filters compose correctly; results respect ordering and pagination contract.
- Empty result set returns `200` with an empty array and `nextCursor: null` (never `404`).

**Edge Cases**
- `from > to`: `400 query.invalid_range`.
- Filter window beyond retention (`> 7 years` ago): returns empty with a header `X-Retention-Notice: 'window-exceeds-retention'`.
- A user requesting another user's `cardId`: `404` (no existence leak).

**Verification**
- Snapshot tests across multiple filter permutations; property test for ordering stability.

**Performance**
- p95 ≤ **150 ms** for a 7-day window with up to 10k transactions on the user's wallet.

---

### A8. JIT PAN/CVV reveal via Stripe ephemeral keys

**What prompt would you run to complete this task?**
"Implement `POST /v1/cards/{cardId}/reveal-token` that, after SCA step-up, returns a short-lived Stripe ephemeral key the client uses to render PAN/CVV in Stripe.js Issuing Elements. The token must not be loggable and must never traverse our infrastructure as plaintext PAN."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/cards/reveal.controller.ts`
- `services/cards-svc/src/application/issue-reveal-token.handler.ts`
- `services/cards-svc/src/infra/stripe/stripe-issuing.adapter.ts`

**What function do you want to CREATE or UPDATE?**
- `RevealController.requestToken(cardId, idempotencyKey, sessionUser, scaProof)`.
- `IssueRevealTokenHandler.handle(cmd)`.
- `StripeIssuingAdapter.createEphemeralKey(stripeCardId, nonce)`.

**What are details you want to add to drive the code changes?**
- Requires a valid SCA step-up proof (`scaProof`) issued by `identity-svc` within the last 120 seconds.
- Returns `{ ephemeralKey, nonce, expiresAt }` where `ephemeralKey` is the Stripe-signed object. TTL is dictated by Stripe and is typically **60 seconds**; the API surfaces the upstream `expiresAt`.
- Logger has a structural denylist for the keys `ephemeralKey`, `secret`, `pan`, `cvv`. Body parser does **not** persist this response in any cache or APM payload.
- Audit event `card.reveal_requested.v1` is emitted with `cardId, userId, correlationId` — never the token itself.

**Acceptance Criteria**
- Without a fresh SCA proof, the endpoint returns `401 sca.required` and emits an audit event for the failed attempt.
- A successful response is small (< 4 KB), and a curl test against the staging endpoint shows the token in the response body but not in any log file.
- The same `Idempotency-Key` within the SCA window returns the same key; with a new key, a new Stripe call occurs.

**Edge Cases**
- Card is `FROZEN` or `CLOSED`: `409 card.not_revealable`.
- Card belongs to another user: `404 card.not_found`.
- SCA proof is older than 120 s: `401 sca.required`.

**Verification**
- Unit test asserts logger denylist by attempting to log the response and inspecting captured output.
- Manual security review checklist signed off by the security reviewer (see `agents.md` checkpoint).

**Performance**
- p95 ≤ **400 ms**; p99 ≤ **800 ms**.

---

### A9. Card replacement (reissue) flow

**What prompt would you run to complete this task?**
"Implement `POST /v1/cards/{cardId}/replace` that closes the predecessor with reason `COMPROMISE` or `ROTATION`, issues a new card with the same limits, and links predecessor ↔ successor."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/cards/cards.controller.ts`
- `services/cards-svc/src/application/replace-card.handler.ts`

**What function do you want to CREATE or UPDATE?**
- `CardsController.replace(cardId, body, idempotencyKey, sessionUser)`
- `ReplaceCardHandler.handle(cmd)`.

**What are details you want to add to drive the code changes?**
- Body: `{ reason: 'COMPROMISE' | 'ROTATION' | 'CUSTOMER_REQUEST', copyLimits?: boolean (default true) }`.
- The handler executes a saga: (1) freeze predecessor; (2) issue successor via task A2 path; (3) close predecessor with `closed_reason = reason`, set `successor_card_id`; (4) emit `card.replaced.v1` with `{ predecessorId, successorId, reason }`.
- On failure of step (2), unfreeze the predecessor and surface `502` to the caller.

**Acceptance Criteria**
- After success, the predecessor is `CLOSED` with `successor_card_id`; the successor is `ACTIVE` with `predecessor_card_id`; limits are equal when `copyLimits = true`.
- Replaying with the same `Idempotency-Key` returns the same predecessor/successor pair and does not issue a third card.

**Edge Cases**
- Predecessor is already `CLOSED`: `409 card.illegal_transition`.
- Successor issuance succeeds at Stripe but local commit fails: the compensating job reconciles within ≤ 60 s; no orphaned Stripe cards are left active (closed at Stripe with reason `local_commit_failed`).

**Verification**
- E2E test asserts wallet continuity (no double-charge or balance drift during replacement).

**Performance**
- p95 ≤ **2.0 s** (two Stripe calls); p99 ≤ **3.5 s**.

---

### A10. Card closure with reason codes

**What prompt would you run to complete this task?**
"Implement `POST /v1/cards/{cardId}/close` accepting a reason from a controlled vocabulary and closing the card at Stripe."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/cards/cards.controller.ts`
- `services/cards-svc/src/application/close-card.handler.ts`

**What function do you want to CREATE or UPDATE?**
- `CardsController.close(cardId, body, idempotencyKey, sessionUser)`
- `CloseCardHandler.handle(cmd)`.

**What are details you want to add to drive the code changes?**
- Allowed reasons: `LOST`, `STOLEN`, `COMPROMISE`, `CUSTOMER_REQUEST`, `INACTIVITY`, `OPS_ACTION`. `OPS_ACTION` is rejected on the user BFF; allowed only on `bff-internal`.
- Closed cards remain queryable for the full retention period.

**Acceptance Criteria**
- Closing an `ACTIVE` or `FROZEN` card returns `200` with `state = CLOSED` and `closed_reason` set; further mutations return `409`.

**Edge Cases**
- In-flight authorizations after closure: declined by Stripe; if a webhook still arrives, the projector records the decline and tags `post_closure = true`.

**Verification**
- Integration test: close → attempt freeze → expect `409`.

**Performance**
- p95 ≤ **500 ms**.

---

### A11. Dispute intake & evidence upload

**What prompt would you run to complete this task?**
"Implement `POST /v1/transactions/{txnId}/disputes` and `POST /v1/disputes/{disputeId}/evidence` in `disputes-svc`, mirroring status from Stripe Issuing dispute webhooks."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/disputes/disputes.controller.ts`
- `services/disputes-svc/src/application/open-dispute.handler.ts`
- `services/disputes-svc/src/application/upload-evidence.handler.ts`
- `services/disputes-svc/src/webhooks/stripe.controller.ts`
- `services/disputes-svc/migrations/0001_create_disputes.sql`

**What function do you want to CREATE or UPDATE?**
- `DisputesController.open(txnId, body, idempotencyKey, sessionUser)`
- `DisputesController.uploadEvidence(disputeId, file, idempotencyKey, sessionUser)`
- `DisputesWebhookController.receive(rawBody, signature)`.

**What are details you want to add to drive the code changes?**
- Disputes table: `id ULID PK`, `transaction_id ULID`, `card_id ULID`, `user_id ULID`, `stripe_dispute_id TEXT UNIQUE`, `reason TEXT NOT NULL`, `status TEXT NOT NULL`, `evidence_object_keys TEXT[]`, `opened_at TIMESTAMPTZ`, `closed_at TIMESTAMPTZ NULL`, `version INT`.
- Evidence is uploaded to a private S3 bucket in `eu-west-1` with SSE-KMS using a customer-managed key; object keys are stored, not the file contents.
- Allowed reasons (closed vocabulary): `FRAUDULENT`, `DUPLICATE`, `MERCHANDISE_NOT_RECEIVED`, `MERCHANDISE_NOT_AS_DESCRIBED`, `CREDIT_NOT_PROCESSED`, `OTHER`.

**Acceptance Criteria**
- Opening a dispute on a `CAPTURED` transaction returns `201` with `id, status: 'NEEDS_RESPONSE'`.
- Evidence upload accepts JPEG, PNG, PDF up to 5 MB; rejects other types with `415`.
- Status changes from Stripe are reflected within p95 **2 s** after webhook receipt.

**Edge Cases**
- Open dispute on an authorized-but-not-captured txn: `409 dispute.not_yet_disputable`.
- Open dispute on a foreign user's txn: `404 transaction.not_found`.
- Stripe rejects the dispute (e.g., past the window): local row is updated to `LOST` with `closed_at` and a reason emitted in the audit event.

**Verification**
- Integration test using Stripe Issuing test helpers exercises the full open → evidence → status-change loop.

**Performance**
- p95 open ≤ **600 ms**; evidence upload ≤ **1.5 s** for a 5 MB file.

---

### A12. Internal back-office endpoints (Ops, Support, Fraud)

**What prompt would you run to complete this task?**
"Implement `bff-internal` endpoints for Ops/Support/Fraud with strict RBAC and masked data on the Support surface."

**What file do you want to CREATE or UPDATE?**
- `services/bff-internal/src/cards/internal-cards.controller.ts`
- `services/bff-internal/src/auth/rbac.guard.ts`
- `services/bff-internal/src/cards/masking.interceptor.ts`

**What function do you want to CREATE or UPDATE?**
- `InternalCardsController.search(query, internalUser)`
- `InternalCardsController.freeze(cardId, body, internalUser)` (Ops & Fraud)
- `InternalCardsController.close(cardId, body, internalUser)` (Ops only)
- `MaskingInterceptor.intercept(...)` — strips/masks fields based on role.

**What are details you want to add to drive the code changes?**
- Roles: `OPS`, `SUPPORT`, `FRAUD`. Permission matrix is exported as a static map; any change requires a code review tagged `permission-matrix`.
- Support sees `last4`, `userId` (pseudonymized to a stable hash), `state`, `createdAt`, but never `nickname` (user-supplied free text) or transaction merchant names.
- All internal endpoints emit `internal.action.v1` audit events.

**Acceptance Criteria**
- Support role calling the close endpoint receives `403 rbac.forbidden`.
- All internal mutating operations produce both a domain event and an `internal.action.v1` audit event with `actorRole`, `actorId`, `targetCardId`, `correlationId`.

**Edge Cases**
- An internal user impersonating another role via spoofed headers: rejected at the BFF auth middleware; the upstream identity claim is the only source of truth.

**Verification**
- A permission-matrix test enumerates every (role, endpoint) pair and asserts the expected allow/deny.

**Performance**
- p95 search ≤ **250 ms** for the user's last 30 days of cards across the platform's growth-tier dataset.

---

### A13. Outbox publisher and Kafka topic schemas

**What prompt would you run to complete this task?**
"Implement a transactional outbox publisher per service, publishing to Kafka topics using Avro schemas in `libs/events`. Guarantee at-least-once delivery with idempotent consumers."

**What file do you want to CREATE or UPDATE?**
- `libs/events/avro/cards/*.avsc`
- `services/*/src/infra/outbox/outbox.publisher.ts`

**What function do you want to CREATE or UPDATE?**
- `OutboxPublisher.start()` / `stop()`; internal loop reads unpublished rows, publishes, marks `published_at`.

**What are details you want to add to drive the code changes?**
- Topic naming: `lumen.<context>.<entity>.<event>.v<n>`. Partition key: aggregate id (e.g., `cardId`).
- Outbox table: `id ULID PK`, `topic TEXT`, `key TEXT`, `payload JSONB`, `headers JSONB`, `created_at`, `published_at NULL`. Index on `(published_at NULL, created_at)`.
- Headers: `correlationId`, `causationId`, `eventId` (ULID), `schemaVersion`.

**Acceptance Criteria**
- A row is published exactly when its transaction commits; if the publisher crashes mid-publish, the next run re-publishes only unpublished rows.
- Consumers de-dup by `eventId`.

**Edge Cases**
- Kafka unavailable for > 5 minutes: the publisher backs off exponentially and lag is reported via `outbox_unpublished_count`.
- Schema-incompatible payload: the publisher quarantines the row in `outbox_dead_letters` and alerts.

**Verification**
- Chaos test kills the publisher mid-loop; final published set equals all committed outbox rows.

**Performance**
- p95 publish lag ≤ **500 ms** end-to-end (commit → consumer receive) at growth-tier load.

---

### A14. Notifications fan-out (push / email / SMS)

**What prompt would you run to complete this task?**
"Build `notifications-svc` to consume domain events and dispatch to push, email, and SMS providers with templated, localized messages. Respect user channel preferences."

**What file do you want to CREATE or UPDATE?**
- `services/notifications-svc/src/consumers/cards.consumer.ts`
- `services/notifications-svc/src/dispatch/dispatcher.ts`
- `services/notifications-svc/src/templates/*.hbs`

**What function do you want to CREATE or UPDATE?**
- `CardsEventsConsumer.onCardFrozen(event)`, `onCardClosed(event)`, `onLimitsUpdated(event)`, etc.
- `Dispatcher.send(channel, userId, templateId, vars)`.

**What are details you want to add to drive the code changes?**
- Provider abstractions: `PushProvider`, `EmailProvider`, `SmsProvider`; production wires APNs/FCM, SES, and an SMS aggregator.
- Templates are version-controlled, parameterized, and never include `pan`, `last4` (except for the last-4 digits in a freeze message), or merchant detail beyond the masked name.
- User channel preferences are fetched from `identity-svc`; SMS is opt-in.

**Acceptance Criteria**
- A `card.frozen.v1` event results in **at most one** notification per channel within 1 minute, even on consumer restart.
- Disabled channels are silently skipped; an audit row records the suppression.

**Edge Cases**
- User has no verified phone but SMS opt-in is `true`: SMS is suppressed; an `internal.warning.v1` event is emitted.
- A template render error: the message is dead-lettered; on-call is paged after 50 errors in 5 minutes.

**Verification**
- Consumer integration test asserts idempotency on duplicate event delivery.

**Performance**
- Fan-out latency p95 ≤ **3 s** event-to-dispatch; provider RTT excluded.

---

### A15. Observability, health, and dev environment

**What prompt would you run to complete this task?**
"Wire OpenTelemetry traces, structured JSON logs, Prometheus metrics, `/healthz`, `/readyz` and a docker-compose-based dev environment that runs all services with Postgres, Redis, Kafka, and a Stripe Issuing test webhook tunnel."

**What file do you want to CREATE or UPDATE?**
- `services/*/src/observability/*.ts`
- `docker-compose.dev.yaml`
- `Makefile` (root)

**What function do you want to CREATE or UPDATE?**
- `bootstrapObservability(serviceName)` per service.

**What are details you want to add to drive the code changes?**
- Logs: JSON, fields `ts, level, msg, service, correlationId, userId?, cardId?, error.code?, latencyMs?`. Denylist `pan, cvv, expiry, ephemeralKey, secret`.
- Metrics: standard RED + domain (`cards_issued_total`, `cards_state_total{state=...}`, `stripe_webhook_signature_failures_total`, `outbox_unpublished_count`).
- Traces: every HTTP and Kafka boundary creates a span; `correlationId` is injected as a span attribute and log field.

**Acceptance Criteria**
- `make dev` brings the system up; a happy-path smoke test passes in ≤ 5 minutes from a clean clone.
- A failing dependency (e.g., Stripe sandbox down) causes `/readyz` to flip and the service is removed from load balancing.

**Edge Cases**
- Log lines exceeding 16 KB are truncated with a `truncated=true` marker; PII in the truncated body cannot leak (denylist filters before truncation).

**Verification**
- Manual smoke + a CI job that runs the dev environment headlessly for the happy path.

**Performance**
- Tracing overhead ≤ 2% of p95 latency at growth-tier load.

---

# Part B — Banking-Specific Specification Template (Compliance / Security / Audit Overlay)

> Ingest the information from this file, implement the Low-Level Tasks, and generate the code that will satisfy the High and Mid-Level Objectives.

> **Relationship to Part A:** Part B does not re-issue functionality. It re-frames Lumen Cards under the constraints of a regulated EU FinTech and adds **net-new** low-level tasks that exist *only because* of compliance, security, audit, retention, and reliability requirements. Where Part A says "implement an endpoint", Part B says "ensure that endpoint is trustworthy in a regulated environment."

## High-Level Objective

- Make Lumen Cards **safe to operate** in an EU/EEA regulated environment: provably auditable, demonstrably PCI-out-of-scope, GDPR-respectful, PSD2-SCA-compliant for sensitive actions, observable enough for incident response, and resilient enough to meet a **99.95%** monthly SLO on the authorization path.

## Mid-Level Objectives

1. **Regulatory compliance is built-in, not bolted on.** PSD2 SCA gates every PSD2-defined "sensitive action" (PAN reveal, limit changes above a threshold, card replacement, dispute opening). GDPR data-subject rights (access, rectification, erasure, portability) are first-class APIs on `bff-internal`.
2. **Security boundaries are explicit and enforced in code.** No PAN/CVV ever touches Lumen Cards storage, logs, traces, or analytics. All Stripe Issuing interactions occur from a narrow set of egress-restricted services. Internal-to-internal calls are mTLS-authenticated; user sessions use HTTP-only, `Secure`, `SameSite=Strict` cookies with rotating session IDs.
3. **Auditability is tamper-evident and queryable.** Every business and admin action is recorded in `audit-svc` with `actor, action, target, before/after (where applicable), correlationId, timestamp`, hash-chained per partition so retroactive tampering is detectable. Retention is **7 years** for financial events, **5 years** for access/security events.
4. **Data handling matches GDPR principles.** Personal data is minimized (no nickname free text in event payloads), pseudonymized where stable identifiers suffice, encrypted at rest with KMS-managed customer keys, and erasable on request with cryptographic proof of action.
5. **Performance and reliability targets are explicit and verified.** The authorization path (Stripe webhook in → projection out → user-visible) sustains **500 auth/sec peak** with p95 projection lag ≤ 2 s and 99.95% monthly availability. The user-facing API meets the budgets stated in Part A's per-task **Performance** sections.
6. **Operational readiness is part of done.** Runbooks for each top-5 incident class exist before launch; on-call dashboards correspond to the SLO; chaos and DR drills are scheduled and documented.
7. **Third-party / outsourcing risk is governed.** Stripe Issuing as a critical processor is treated under EBA outsourcing guidelines: exit plan documented, monitoring of provider availability, and contractually-aligned incident escalation paths.

## Implementation Notes

- **GDPR & data privacy.**
  - **Lawful bases:** processing of cardholder personal data rests on (i) contract performance for issuance and lifecycle, and (ii) legal obligation for audit and recordkeeping. Document the basis per processing activity in `docs/processing-register.md`.
  - **Pseudonymization:** any `userId` leaving the platform in events emitted to non-essential consumers is replaced with a stable HMAC-SHA256 over a per-consumer salt; the salt rotates yearly and is stored in AWS KMS.
  - **Erasure (right to be forgotten):** within **30 days** of a verified erasure request, personal-data fields on inactive records are replaced with the canonical placeholder `__redacted__` while audit log entries are retained under the financial-records retention obligation (with a documented overrides log entry).
  - **Data residency:** EU-only S3 buckets, EU-only RDS, EU-only Kafka. Any cross-region call is rejected by a deploy-time policy check (`infra/policies/data-residency.rego`).
- **Audit-trail requirements.**
  - `audit-svc` exposes an append-only `audit_events` table partitioned monthly. Each row carries `event_hash = SHA256(prev_hash || row_payload)`, forming a hash chain per partition. The previous-hash watermark is committed daily to a write-once S3 object (`audit-watermarks/`) with object lock.
  - Audit events include: every state change on cards, every internal admin action, every PAN reveal request (success **and** failure), every SCA challenge outcome, every GDPR subject-request lifecycle step.
  - Audit query API exposes read-only endpoints with role-based filtering, never the chain-internal `event_hash`.
- **Error handling & logging.**
  - All logger calls go through a single `LumenLogger` that enforces the field denylist (`pan, cvv, expiry, ephemeralKey, secret, sessionId`) and truncates oversized payloads. Use of `console.log`/`console.error` in `src/**` is a CI failure.
  - Errors surfaced to users carry stable `error.code` strings; the human-readable `message` is localized (`en`, `fr`, `de`, `es`) via ICU MessageFormat.
- **Input validation & sanitization.**
  - All controllers use `class-validator` + `class-transformer` with strict whitelist mode; unknown fields produce `422 validation.unknown_field`.
  - All free-text inputs (nicknames, dispute notes) are length-bounded and stripped of control characters; never interpreted as HTML.
- **Monetary calculations.**
  - All amounts are integer minor units (`bigint` in TypeScript, `BIGINT` in PostgreSQL). No float arithmetic. Where multiplication is needed (e.g., percentages), use `bn.js`/`big.js` with explicit rounding mode (`ROUND_HALF_EVEN` for any banking rounding) — though MVP does not need this; the rule still applies preemptively.
- **Comprehensive testing.**
  - Coverage targets: **≥ 85% line / 90% branch** on `cards-svc` and `disputes-svc` core domains; lower thresholds (≥ 70%) on BFFs because their logic is thin.
  - Test categories: unit (FSM, validators, mappers), integration (DB, Stripe sandbox, Kafka), contract (OpenAPI vs controllers), property (pagination ordering, idempotency), and end-to-end smoke (`make e2e`).
- **Resilience patterns.** Bulkhead Stripe egress with a dedicated thread pool / NestJS module per dependency; circuit-break on > 50 errors/min sustained; fall back to user-visible `502 stripe.upstream_unavailable` and an internal-only dashboard.

## Context

### Beginning context (banking lens)

- Part A's beginning context applies. In addition:
- A **PCI DSS scoping document** exists at `docs/pci-scope.md` and asserts that Lumen Cards is out-of-CDE; this Part B work must keep that assertion true.
- A **GDPR Record of Processing Activities (RoPA)** placeholder exists at `docs/ropa.md`.
- A **Stripe Issuing DPA** is in place; the engineering team treats Stripe as a sub-processor under the platform's GDPR DPA with end-users.
- AWS KMS customer-managed keys (CMKs) exist for: at-rest encryption (`alias/lumen-rds`), audit object lock (`alias/lumen-audit-watermarks`), pseudonymization HMAC (`alias/lumen-pseudonymization-salt`).

### Ending context (banking lens)

When Part B is fully implemented, the following exist in addition to Part A's outcomes:

- `audit-svc` is live with a hash-chained `audit_events` table, daily watermark commits to S3 with object-lock, and a read API on `bff-internal`.
- A **PSD2 SCA enforcement** layer exists in `bff-user` that gates the actions defined below; SCA outcomes are persisted as audit events.
- A **GDPR data-subject request (DSR) workflow** exists on `bff-internal`: intake, identity verification, scope of records, redaction job, completion proof.
- A **secrets-and-key-rotation policy** is documented and enforced (CMKs rotated annually; service-account credentials rotated quarterly; webhook secrets rotated quarterly).
- A **runbook set** covers: Stripe Issuing outage, Kafka outage, PostgreSQL primary failover, suspected PAN exposure (containment + notification SLAs), high-fraud-velocity incident, GDPR DSR backlog.
- An **SLO dashboard** corresponds to the authorization-path budget (99.95%, p95 ≤ 2 s lag) and a separate user-API budget; error budgets and burn-rate alerts are wired.
- A **compliance review checklist** (`docs/compliance-checklist.md`) is signed off by Compliance before launch, with traceability links from each item to a low-level task in this spec.

## Low-Level Tasks (Part B)

> Numbering continues from Part A so cross-references are unambiguous.

### B1. PSD2 SCA enforcement layer

**What prompt would you run to complete this task?**
"Build a guard in `bff-user` that requires a fresh SCA step-up for every PSD2-defined sensitive action and persists the SCA outcome to the audit log."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/auth/sca.guard.ts`
- `services/bff-user/src/auth/sca-required.decorator.ts`
- `libs/contracts/openapi/bff-user.yaml`

**What function do you want to CREATE or UPDATE?**
- `ScaGuard.canActivate(ctx)`; `@ScaRequired(level: 'STANDARD' | 'STRONG')` decorator.

**What are details you want to add to drive the code changes?**
- Sensitive actions and SCA freshness windows (max age since last successful SCA challenge):
  - PAN/CVV reveal (Task A8): **120 s**, level `STRONG`.
  - Increase limits above €1,000/day or €5,000/month: **300 s**, `STANDARD`.
  - Card replacement (A9): **300 s**, `STANDARD`.
  - Open dispute (A11): **300 s**, `STANDARD`.
- The guard verifies `scaProof` (signed JWT issued by `identity-svc`), checks freshness, and emits `auth.sca.outcome.v1` regardless of success/failure.
- Replay protection: each `scaProof` carries a `jti`; the guard rejects re-use beyond a single sensitive call (cache in Redis with TTL = freshness window).

**Acceptance Criteria**
- A request without `scaProof` on a `@ScaRequired` route returns `401 sca.required` and produces a failure audit event with `correlationId`.
- A stale `scaProof` returns `401 sca.stale`.
- A reused `scaProof` returns `401 sca.replay_detected`.

**Edge Cases**
- Clock skew: tolerate ±60 s; beyond that, treat as stale.
- Identity service unavailable: gate fails closed (`503 sca.unverifiable`), and the failure is audited.

**Verification**
- Permission matrix test: every `@ScaRequired` route is exercised without proof, with stale proof, and with reuse, asserting the correct error code.
- A static-analysis CI rule asserts every sensitive route (allow-listed in `sensitive-routes.yaml`) carries `@ScaRequired`.

**Performance**
- Guard overhead p95 ≤ **10 ms** (Redis hit) / ≤ **40 ms** (Redis miss + JWT verify).

---

### B2. Tamper-evident audit log in `audit-svc`

**What prompt would you run to complete this task?**
"Implement an append-only, hash-chained audit event store with daily watermarking to S3 Object Lock, and a read API on `bff-internal`."

**What file do you want to CREATE or UPDATE?**
- `services/audit-svc/src/domain/audit-event.entity.ts`
- `services/audit-svc/src/application/append.handler.ts`
- `services/audit-svc/src/application/watermark.job.ts`
- `services/audit-svc/migrations/0001_create_audit_events.sql`
- `services/bff-internal/src/audit/audit.controller.ts`

**What function do you want to CREATE or UPDATE?**
- `AppendAuditEvent.handle(event)`
- `WatermarkJob.run()` (daily, idempotent)
- `AuditController.search(query, internalUser)`

**What are details you want to add to drive the code changes?**
- Table partitions by month: `audit_events_YYYY_MM`. Columns: `id ULID PK`, `partition_key TEXT` (e.g., `cards`, `auth`, `disputes`), `actor JSONB`, `action TEXT`, `target JSONB`, `before JSONB NULL`, `after JSONB NULL`, `correlation_id ULID`, `occurred_at TIMESTAMPTZ`, `prev_hash BYTEA`, `event_hash BYTEA`, `schema_version INT`.
- `event_hash = SHA256(prev_hash || canonical_json(row_without_hashes))`. Canonicalization uses RFC 8785 JCS to make hashes deterministic across languages.
- Daily watermark: at 00:30 UTC, compute the last `event_hash` per partition and write `{ partition, watermarkTime, lastEventId, lastEventHash }` to S3 with Object Lock retention = `7 years` (financial events) or `5 years` (security/access). Bucket has versioning, MFA delete, and CRR within EU only.
- Audit API: filterable by `actorRole, action, targetType, targetId, dateRange`; results never expose `event_hash` or `prev_hash`.

**Acceptance Criteria**
- Inserting an audit event without going through `AppendAuditEvent` is forbidden by DB role permissions (`audit_writer` is the only role with `INSERT`, and only used by the service account).
- A tampered row (manually changed `after` field) is detected by a `verify-chain` CLI tool that re-computes hashes and reports the first divergence within ≤ 30 seconds per million rows.
- A watermark written today verifies tomorrow against the chain.

**Edge Cases**
- A retroactive insert attempt with `occurred_at` < latest is rejected (the table has a trigger enforcing monotonically increasing `occurred_at` per partition; out-of-order events are placed in a quarantine table for review).
- Watermark job fails: retries with exponential backoff; if 3 consecutive failures, page on-call (this is a regulatory control).

**Verification**
- Chain-verification test on a 1M-row fixture detects a synthetic tamper.
- Pen-test mock: an internal user with read-only access cannot insert or update rows.

**Performance**
- Append p95 ≤ **20 ms** at 1k events/sec.
- Verification CLI ≥ **1M rows / 30 s**.

---

### B3. GDPR data-subject request (DSR) workflow

**What prompt would you run to complete this task?**
"Build a DSR intake-and-fulfillment workflow on `bff-internal` supporting access, rectification, erasure, and portability requests, with identity verification and proof-of-action."

**What file do you want to CREATE or UPDATE?**
- `services/bff-internal/src/dsr/dsr.controller.ts`
- `services/cards-svc/src/application/dsr-handler.ts`
- `services/transactions-svc/src/application/dsr-handler.ts`
- `services/disputes-svc/src/application/dsr-handler.ts`
- `services/audit-svc/src/application/dsr-handler.ts`

**What function do you want to CREATE or UPDATE?**
- `DsrController.create(body, opsUser)`; `DsrController.complete(dsrId, opsUser)`.
- Per-service `DsrHandler.export(userId)` and `DsrHandler.erase(userId)` callable only via the DSR orchestrator.

**What are details you want to add to drive the code changes?**
- Request types: `ACCESS`, `RECTIFICATION`, `ERASURE`, `PORTABILITY`. SLA: **30 days**. Extendable once by 60 days with documented reason.
- Identity verification of the subject is performed via `identity-svc` (existing flow); the DSR is rejected if the requester cannot be re-authenticated to a `STRONG` SCA level.
- Erasure semantics: replace personal data fields with `__redacted__` on inactive records (`CLOSED` cards, completed disputes); audit-log entries are retained per legal obligation but their `actor.subjectName` and similar PII fields are also redacted (the chain still verifies because `event_hash` is recomputed only on append, not on edit — *redaction is implemented as an "annotation" row, not an in-place edit*).
- Portability format: JSON, ZIP-packaged, signed manifest with SHA256 of each file; deliverable via a short-lived pre-signed URL (15 min).

**Acceptance Criteria**
- A completed `ACCESS` request results in a downloadable archive whose manifest hashes verify.
- A completed `ERASURE` request results in: (a) personal data fields redacted on inactive records, (b) audit events emitted for each redaction, (c) the user can no longer be re-identified by any in-platform identifier other than the pseudonymous internal `userId`.
- The DSR audit row links the request through to the resulting redaction events.

**Edge Cases**
- The user has open disputes or unsettled transactions: erasure is blocked with a documented exception; the DSR row reflects "PENDING_LEGAL_OBLIGATION" and is re-evaluated after closure.
- The user has only ever had `PENDING` cards: erasure proceeds normally; the export archive is empty for transactions/disputes.

**Verification**
- E2E test exercises the full intake → verify → fulfill → proof loop.
- A compliance reviewer checklist (in `docs/compliance-checklist.md`) is signed off before the feature ships.

**Performance**
- Export p95 ≤ **10 s** for a user with ≤ 5,000 transactions; ≤ **60 s** at the 99th percentile.

---

### B4. Pseudonymization and PII minimization in events

**What prompt would you run to complete this task?**
"Wrap event publishers with a pseudonymizer that replaces `userId` and email-like fields with stable HMAC-SHA256 pseudonyms per consumer salt before emission to non-essential consumers."

**What file do you want to CREATE or UPDATE?**
- `libs/events/src/pseudonymizer.ts`
- `services/*/src/infra/outbox/outbox.publisher.ts`

**What function do you want to CREATE or UPDATE?**
- `Pseudonymizer.pseudonymize(payload, schema)`; `OutboxPublisher.beforePublish(hook)`.

**What are details you want to add to drive the code changes?**
- "Essential consumers" (e.g., `notifications-svc` needing a real `userId`) are explicitly allow-listed in `libs/events/policy.yaml`. All other topics receive pseudonymized identifiers.
- Per-consumer salts live in AWS KMS; rotation occurs annually and produces a new salt version; the publisher records both the version and the original-id-hash relation in an internal-only lookup table so support can re-identify when needed.
- Free-text fields (e.g., card `nickname`) are **stripped** entirely from events (not just pseudonymized).

**Acceptance Criteria**
- For non-essential topics, the published payload contains no plaintext `userId`, email, or nickname.
- A salt-rotation drill replaces salts without breaking consumer joins (the lookup table maps old → new pseudonyms during overlap).

**Edge Cases**
- A schema evolution introduces a new PII field: a CI check fails until `policy.yaml` is updated.

**Verification**
- A static-analysis test scans all emitted Avro schemas and asserts every `subject_user_id` field is annotated as `pseudonymized=true` for non-essential topics.

**Performance**
- Pseudonymizer overhead p95 ≤ **0.5 ms** per event (HMAC + memcache hit).

---

### B5. Encryption at rest and key management

**What prompt would you run to complete this task?**
"Configure all data stores to use customer-managed KMS keys, enable PostgreSQL TDE-equivalent, S3 SSE-KMS, and Kafka encryption-in-transit + at-rest. Document the key inventory."

**What file do you want to CREATE or UPDATE?**
- `infra/terraform/kms/*.tf`
- `infra/terraform/rds/*.tf`
- `infra/terraform/s3/*.tf`
- `docs/key-inventory.md`

**What function do you want to CREATE or UPDATE?**
- Terraform modules `kms`, `rds`, `s3`, `msk` (Kafka).

**What are details you want to add to drive the code changes?**
- Separate CMKs per domain: RDS, S3 audit watermarks, S3 dispute evidence, pseudonymization HMAC, secrets-manager.
- All keys are AWS KMS `SYMMETRIC_DEFAULT`, in EU regions only, with annual rotation enabled.
- Key policies: only the service account roles can `Decrypt`; only break-glass roles (with MFA) can `Disable`/`ScheduleKeyDeletion`.

**Acceptance Criteria**
- `aws kms list-keys` in any non-EU region returns zero Lumen-tagged keys.
- A scheduled Trivy / Checkov scan finds no resource without `kms_key_id` set.

**Edge Cases**
- A key rotation breaks a downstream that pinned a key version: mitigated by always using key aliases (never key IDs) in code.

**Verification**
- Terraform plan diff posted on PR; security review approves before apply.

**Performance**
- KMS-induced overhead on RDS connections p95 ≤ **5 ms** above non-KMS baseline.

---

### B6. Stripe webhook signature, inbox, and replay defense

**What prompt would you run to complete this task?**
"Harden the Stripe webhook ingress: verify signatures using the raw body, reject events older than 5 minutes (Stripe-recommended), and persist to the inbox before processing."

**What file do you want to CREATE or UPDATE?**
- `services/transactions-svc/src/webhooks/stripe.controller.ts` (extends Task A6)
- `services/disputes-svc/src/webhooks/stripe.controller.ts` (extends Task A11)

**What function do you want to CREATE or UPDATE?**
- `verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300)`.

**What are details you want to add to drive the code changes?**
- Use the raw body (not the JSON-parsed object) — configured via a NestJS `bodyParser: false` route override.
- Secrets are loaded from AWS Secrets Manager and rotated quarterly; the verifier accepts the prior secret for a 24-hour grace period during rotation.
- Replay defense: an inbox unique constraint on `event_id` + a five-minute timestamp tolerance.

**Acceptance Criteria**
- A fuzz test sending tampered signatures fails 100% of the time and emits one audit event per failure.
- During a rotation drill, both old and new secrets validate for the documented grace window.

**Edge Cases**
- Stripe replays the same event after our processing succeeded: inbox dedup ensures no double effect.
- An attacker sends a valid-looking signature with an old timestamp: rejected by tolerance check.

**Verification**
- Negative tests cover: missing signature, expired timestamp, tampered body, valid-but-wrong-secret signatures.

**Performance**
- Verification p95 ≤ **3 ms**; inbox insert p95 ≤ **10 ms**.

---

### B7. Rate limiting, abuse prevention, and fraud-velocity caps

**What prompt would you run to complete this task?**
"Add a token-bucket rate limiter on `bff-user` keyed by user and action class, with global per-IP secondary limits. Add velocity caps for fraud-sensitive operations."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/ratelimit/ratelimit.guard.ts`
- `services/bff-user/src/ratelimit/policies.yaml`

**What function do you want to CREATE or UPDATE?**
- `RateLimitGuard.canActivate(ctx)`.

**What are details you want to add to drive the code changes?**
- Default policy: 60 req/min per user across all routes; per-route overrides:
  - `POST /v1/cards`: **5 / hour** per user.
  - `POST /v1/cards/{id}/reveal-token`: **10 / hour** per user; **3 consecutive failures → 1-hour cooldown**.
  - `POST /v1/cards/{id}/freeze` / `unfreeze`: **20 / hour** per user.
- Secondary per-IP limit: 600 req/min; suspicious-class IPs (from `risk-svc`) get **60 req/min**.
- Backed by Redis with sliding-window counters.

**Acceptance Criteria**
- Exceeding a limit returns `429 rate.limited` with `Retry-After`.
- Limit decisions are logged but never include request bodies.

**Edge Cases**
- Redis unavailable: fail open for read-only routes; fail closed for sensitive routes (reveal, replace).

**Verification**
- Load test exercises every limit at boundary ± 1 request.

**Performance**
- Guard overhead p95 ≤ **3 ms** (Redis on the same VPC).

---

### B8. Permission matrix & RBAC for internal users

**What prompt would you run to complete this task?**
"Codify the internal RBAC matrix (Ops, Support, Fraud) as a static, reviewed map; enforce in `bff-internal`; and prevent privilege escalation through impersonation."

**What file do you want to CREATE or UPDATE?**
- `services/bff-internal/src/auth/permissions.matrix.ts`
- `services/bff-internal/src/auth/rbac.guard.ts` (extends A12)

**What function do you want to CREATE or UPDATE?**
- `RbacGuard.canActivate(ctx)` (extended); `assertRoleAllowed(role, action)`.

**What are details you want to add to drive the code changes?**
- Matrix is a `Readonly<Record<Role, ReadonlySet<Action>>>` exported as JSON-serializable; any change requires a PR labeled `permission-matrix` and an approval from a Compliance reviewer (enforced by a CI rule).
- Impersonation (Ops acting on behalf of a user) is forbidden for user-only actions (PAN reveal, dispute opening). All Ops-initiated actions emit an `internal.action.v1` audit event with `actorRole = 'OPS'` and `onBehalfOfUserId = null`.

**Acceptance Criteria**
- Every (role × action) pair has explicit `ALLOW` or `DENY`; absence is treated as `DENY`.
- A CI rule fails the build if a controller method exists without a matching matrix entry.

**Edge Cases**
- A user with multiple roles (e.g., Ops + Fraud temporarily): effective permissions are the **union**; audit event records all active roles.

**Verification**
- A generated test exercises every (role × endpoint × method) cell.

**Performance**
- RBAC check is in-memory; p99 ≤ **100 µs**.

---

### B9. Reliability: SLOs, error budgets, and runbooks

**What prompt would you run to complete this task?**
"Define SLOs for the authorization path and user API, wire burn-rate alerting, and publish a runbook catalog."

**What file do you want to CREATE or UPDATE?**
- `infra/observability/slo.yaml`
- `docs/runbooks/*.md`
- `infra/observability/alerts.yaml`

**What function do you want to CREATE or UPDATE?**
- Not a code function; SLO config + alert routes + runbooks.

**What are details you want to add to drive the code changes?**
- SLOs:
  - **Authorization path** (Stripe webhook → projection visible): 99.95% monthly; p95 projection lag ≤ 2 s; p99 ≤ 5 s.
  - **User-facing API**: 99.9% monthly; p95 ≤ 800 ms across mutating routes; p95 ≤ 150 ms across read routes.
  - **Audit append**: 99.99% (regulatory control); no measured `audit_lost` events allowed per quarter.
- Burn-rate alerts: 2% over 1h **and** 5% over 6h (fast burn), 10% over 3d (slow burn).
- Runbook catalog (each runbook lists: detection, immediate mitigation, customer comms decision, escalation, post-incident review owner): Stripe outage, Kafka outage, RDS failover, suspected PAN exposure (P0), webhook secret leak, rate-limit storm, audit chain anomaly.

**Acceptance Criteria**
- A staged outage triggers alerts within the burn-rate windows and routes to the on-call.
- A monthly SLO report is auto-generated from Prometheus.

**Edge Cases**
- Alert fatigue: each runbook has documented "do not page if …" conditions; flapping alerts are suppressed for 10 minutes by Alertmanager rules.

**Verification**
- Game-day drill executes one runbook per quarter; outcomes recorded in `docs/drills/`.

**Performance**
- N/A (the targets *are* the performance contract).

---

### B10. Disaster recovery & backups

**What prompt would you run to complete this task?**
"Define RPO/RTO targets and implement automated backups, cross-AZ failover, and a quarterly DR drill."

**What file do you want to CREATE or UPDATE?**
- `infra/terraform/rds/backups.tf`
- `infra/terraform/s3/replication.tf`
- `docs/dr-plan.md`

**What function do you want to CREATE or UPDATE?**
- Terraform configurations; documented procedure (`docs/dr-plan.md`).

**What are details you want to add to drive the code changes?**
- RPO ≤ **5 min** (RDS continuous backup + PITR); RTO ≤ **60 min** (cross-AZ automatic failover, warm DR in `eu-central-1`).
- Audit S3 buckets replicated to `eu-central-1` within EU only; object lock retains records across regions.
- Quarterly DR drill: cut over to `eu-central-1` for a read-only period; record actual RTO and gaps.

**Acceptance Criteria**
- Backup restoration is verified weekly by a script that restores the latest snapshot to a sandbox account and runs a smoke test.
- DR drill produces a written outcome stored in `docs/drills/`.

**Edge Cases**
- DR region also degraded: documented escalation to a paused-write mode that maintains read access and serializes new writes once primary recovers.

**Verification**
- Quarterly drill report.

**Performance**
- Failover p95 within 60 min target during drill.

---

### B11. Third-party / outsourcing risk: Stripe Issuing governance

**What prompt would you run to complete this task?**
"Document and implement governance controls for Stripe Issuing as a critical processor under EBA outsourcing guidelines."

**What file do you want to CREATE or UPDATE?**
- `docs/outsourcing-register.md`
- `services/cards-svc/src/infra/stripe/health-monitor.ts`
- `infra/observability/alerts.yaml`

**What function do you want to CREATE or UPDATE?**
- `StripeHealthMonitor.probe()` — periodic synthetic auth simulation against Stripe sandbox.

**What are details you want to add to drive the code changes?**
- Outsourcing register entries include: provider, criticality, data shared, sub-processors, exit plan summary, last assessed date.
- Health monitor probes Stripe Issuing every 60 s and publishes `stripe.upstream.health` metrics; ≥ 3 consecutive failures pages on-call (P1).
- Exit plan: documented dual-issuer abstraction (`IssuerProcessorPort`); a six-month migration is theoretically feasible; tested via a "fake processor" implementation that passes the same contract tests.

**Acceptance Criteria**
- Outsourcing register is reviewed annually; reviewer signature is in the file's footer.
- The fake processor passes the contract tests applied to `StripeIssuingAdapter` (proving the port is real, not Stripe-shaped).

**Edge Cases**
- Stripe announces a breaking API change: the abstraction limits blast radius; a migration plan is filed within 30 days.

**Verification**
- Contract test suite is shared across the real and fake adapters.

**Performance**
- Health probes negligible (<0.1% of Stripe quota).


# Part C — API Development Specification Template (Lumen Cards REST API Surface)

> Ingest the information from this file, implement the Low-Level Tasks, and generate the code that will satisfy the High and Mid-Level Objectives.

## High-Level Objective

- Deliver a coherent, versioned, well-documented REST API surface across `bff-user` and `bff-internal` to which every feature in Parts A and B conforms — defined once in OpenAPI 3.1, implemented in NestJS 10, secured for an EU regulated environment, and instrumented so the SLOs from Part B can be measured at the edge.

## Mid-Level Objectives

1. **Single source of truth for the contract.** OpenAPI 3.1 documents (`bff-user.yaml`, `bff-internal.yaml`) are authoritative; controllers and DTOs are validated against them in CI; drift fails the build.
2. **Consistent cross-cutting conventions.** Versioning, error envelope, idempotency, pagination, filtering, sorting, correlation-id propagation, and rate-limit declarations behave identically on every endpoint.
3. **Authenticated and authorized by default.** Session cookies for end-users with MFA step-up where Part B requires it; mTLS-backed RBAC for internal users; no anonymous mutating routes.
4. **Safe by default at the HTTP edge.** Strict security headers, CORS allow-listing, request/response size limits, content-type pinning, and explicit `Accept`/`Content-Type` negotiation.
5. **Documented and consumable.** OpenAPI is published to an internal developer portal; a typed TypeScript SDK is generated from the spec for internal consumers; a mock server (Prism) is available for offline frontend work.
6. **Lifecycle-aware.** Deprecation and sunset are first-class: `Deprecation` and `Sunset` headers, a 90-day minimum notice, and a documented migration guide per change.
7. **Partner-ready, not partner-enabled.** The B2B partner-API shape (signed webhooks, API keys, scoped permissions, separate rate-limit profile) is specified now and held behind a feature flag, so enabling partners later is a configuration change rather than a redesign.

## Implementation Notes

- **Framework adaptation.** The template suggests FastAPI; Lumen Cards uses **NestJS 10 + `@nestjs/swagger`**. All template guidance is translated to NestJS equivalents (decorator-driven DTOs, global interceptors/guards/filters, modular controllers).
- **Versioning.** URL prefix `/v1/...`. Breaking changes require a new prefix (e.g., `/v2/...`); non-breaking changes are recorded in `CHANGELOG-API.md` alongside the OpenAPI diff produced in CI by `oasdiff`.
- **HTTP status codes.** Stable mapping: `200` (success on retrieve/update with body), `201` (resource created), `202` (accepted async), `204` (no body), `400` (validation/syntax), `401` (auth missing/invalid), `403` (RBAC denied), `404` (not found or existence-leak masking), `409` (conflict, illegal transition, version conflict), `415` (unsupported media), `422` (semantic validation), `429` (rate limited), `5xx` (server). Avoid creative codes.
- **Error envelope.** Every error response is `{ error: { code, message, correlationId, retryable, details? } }`. `code` is a stable, dotted string from the central catalog (Task C2). `message` is localized via ICU.
- **Idempotency.** Every non-GET, non-HEAD route requires an `Idempotency-Key` header validated by a shared middleware (Task C5). Read endpoints ignore the header.
- **Correlation-id.** Inbound `X-Correlation-Id` is honored when well-formed (ULID); otherwise a new one is generated. Every log/event/audit/outbox row carries it.
- **Pagination.** Cursor-based; `limit ≤ 100` default 20; `nextCursor` opaque; `prevCursor` not provided in MVP (cost vs value). Sorting is endpoint-specific and **whitelisted** in the controller — never accept a free-text `sort` param.
- **Filtering.** Each filter is a typed query parameter with a validator; unknown filters return `422`. No deep-object / JSONPath query inputs.
- **REST principles.** Resource-oriented URLs (`/cards/{id}/limits`), hyphen-lowercase paths, plural collections, **action sub-resources** for transitions where REST verbs are ambiguous (`/cards/{id}/freeze`, `/cards/{id}/close`). Use `PATCH` only with `application/merge-patch+json` semantics; never partial-update via `PUT`.
- **Rate limiting.** Declared via `x-lumen-ratelimit` OpenAPI extension and enforced by Task B7; CI cross-checks that every mutating route has a declared policy.
- **Logging at the edge.** One structured log line per request with `method, path, status, latencyMs, correlationId, userId?`; never request bodies for routes in `sensitive-routes.yaml`.
- **Content types.** Request bodies are `application/json; charset=utf-8` unless the route declares otherwise (e.g., `multipart/form-data` for dispute evidence). Responses are JSON unless the route declares otherwise. `415` is returned when a route receives an unsupported content type.
- **Caching.** Mutating responses use `Cache-Control: no-store`. Read endpoints that are safe to cache use weak ETags + `Cache-Control: private, max-age=10` (Task C12). Audit and reveal endpoints are **never** cacheable.
- **CORS.** Allow-list of first-party origins per environment; no wildcard origins; `Access-Control-Allow-Credentials: true` only for first-party.
- **TLS termination & WAF.** Performed by an AWS-managed edge (CloudFront + AWS WAF) in front of the BFFs; BFFs reject non-TLS connections at the load balancer policy level.

## Context

### Beginning context

- Parts A and B beginning context applies.
- `libs/contracts/openapi/bff-user.yaml` and `libs/contracts/openapi/bff-internal.yaml` skeletons exist with `info`, `servers`, and tag sets pre-populated.
- `libs/sdk-ts/` is an empty placeholder for a generated TypeScript SDK.
- `infra/edge/` contains scaffolding for CloudFront + WAF Terraform modules but no rules yet.

### Ending context

- A complete OpenAPI 3.1 document per BFF, published as a CI artifact and pushed to an internal developer portal (`docs-portal-internal`).
- A generated typed TypeScript SDK in `libs/sdk-ts/` published to the internal npm registry and consumed by the user web app and internal console.
- A Prism mock server running in `make dev` so frontend engineers can develop offline against the contract.
- An enforced API deprecation policy with `Deprecation` and `Sunset` headers and a tooling check that fails CI if a deprecated route is still in use beyond its sunset date.
- A partner-API spec stub at `libs/contracts/openapi/partner-api.yaml`, behind a feature flag, reviewed by Compliance but not enabled.
- A documented error-code catalog (`docs/error-codes.md`) cross-linked from the OpenAPI `components.schemas.Error.code` enumeration.

## Low-Level Tasks (Part C)

> Numbering continues from Part B. Same extended task format: Prompt / File / Function / Details + **Acceptance Criteria** + **Edge Cases** + **Verification** + **Performance**.

### C1. API versioning strategy and deprecation/sunset policy

**What prompt would you run to complete this task?**
"Establish the `/v{n}/` URL versioning scheme, enforce `Deprecation`/`Sunset` headers, and produce an OpenAPI diff gate in CI."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/openapi/bff-user.yaml`
- `libs/contracts/openapi/bff-internal.yaml`
- `docs/api-versioning.md`
- `.github/workflows/api-diff.yml`

**What function do you want to CREATE or UPDATE?**
- N/A (declarative config + a CI workflow invoking `oasdiff`).

**What are details you want to add to drive the code changes?**
- MVP exposes `/v1`. Breaking changes require `/v2` and a 90-day overlap.
- A deprecated route returns `Deprecation: true` and `Sunset: <RFC 7231 date>`; the SDK warns at runtime when called.
- `oasdiff` compares the PR's OpenAPI against `main`; any breaking diff fails CI unless the PR title carries `[breaking]` **and** a `docs/migrations/<date>-<slug>.md` migration note is added.
- A scheduled CI job fails the build of `main` if `now > sunsetDate` for any deprecated route still present.

**Acceptance Criteria**
- A test PR introducing a breaking change without `[breaking]` + migration note is blocked by CI.
- Deprecated routes set both headers; the generated SDK surfaces the warning to the caller.

**Edge Cases**
- A header-only change that **looks** breaking to `oasdiff` but is actually documentation-only: maintainers can override via a `oasdiff-suppress: <reason>` PR label, and the suppression is recorded in the PR audit log.
- Sunset date reached mid-incident: a feature flag can extend the date by ≤ 7 days with an incident ticket reference.

**Verification**
- Unit test on the SDK confirms the deprecation warning is emitted exactly once per process per deprecated route.
- CI workflow dry-run on a synthetic breaking change.

**Performance**
- N/A (build-time only).

---

### C2. Canonical error envelope and error-code catalog

**What prompt would you run to complete this task?**
"Implement a NestJS global exception filter that renders the `{ error: { code, message, correlationId, retryable, details? } }` envelope using a centralized error-code catalog; document every code in `docs/error-codes.md`."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/src/errors/error-catalog.ts`
- `libs/contracts/src/errors/lumen.error.ts`
- `services/*/src/filters/lumen-exception.filter.ts`
- `docs/error-codes.md`

**What function do you want to CREATE or UPDATE?**
- `class LumenError extends Error` with fields `{ code, httpStatus, retryable, message, details? }`.
- `LumenExceptionFilter.catch(exception, host)`.

**What are details you want to add to drive the code changes?**
- Catalog is a `Readonly<Record<ErrorCode, { httpStatus: number; retryable: boolean; defaultMessage: string }>>`. Adding/removing codes requires a CI-checked PR label `error-catalog`.
- The filter never leaks stack traces, processor messages, or DB errors. Underlying errors are logged with full detail; the response only contains the catalog entry plus the request's `correlationId`.
- ICU-localized messages keyed by `code` live in `libs/contracts/i18n/<lang>.json` for `en, fr, de, es`.

**Acceptance Criteria**
- Throwing `new LumenError('card.illegal_transition')` from any handler produces an HTTP `409` with the canonical body.
- A test asserts that no response body across all controllers contains keys like `stack`, `errno`, `sqlState`, `raw`.

**Edge Cases**
- An unmapped exception (`Error` without a code): mapped to `500 internal.unexpected_error`, logged at `error`, paged if the rate exceeds 10/min.
- A handler throws a `LumenError` whose `code` does not exist in the catalog: rejected at compile time by a literal-union TypeScript type.

**Verification**
- Type test (`tsd`) ensures only catalog codes type-check.
- Snapshot test of every catalog code's HTTP status and localized default message.

**Performance**
- Filter overhead p99 ≤ **0.3 ms**.

---

### C3. OpenAPI 3.1 as single source of truth and contract-drift gate

**What prompt would you run to complete this task?**
"Author `bff-user.yaml` and `bff-internal.yaml` as the authoritative OpenAPI 3.1 documents; configure `@nestjs/swagger` to emit a comparable runtime spec; fail CI on drift."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/openapi/bff-user.yaml`
- `libs/contracts/openapi/bff-internal.yaml`
- `services/bff-user/src/openapi/bootstrap.ts`
- `tools/contract-drift/check.ts`

**What function do you want to CREATE or UPDATE?**
- `bootstrapOpenApi(app, document)` — registers Swagger and exposes JSON at `/openapi.json`.
- `tools/contract-drift/check.ts` — diffs the runtime spec against the YAML source.

**What are details you want to add to drive the code changes?**
- All DTOs use `@nestjs/swagger` decorators so the generated spec matches the authored YAML's request/response schemas.
- Drift check uses a normalized AST comparison (order-independent) and tolerates non-semantic differences (e.g., serializer order).

**Acceptance Criteria**
- Adding a controller method without a matching YAML entry fails CI with a diff showing the missing path.
- A schema change in code without a YAML update fails CI.

**Edge Cases**
- A field added to a DTO with `@ApiPropertyOptional` is still considered a contract change and requires a YAML update.

**Verification**
- A synthetic PR that removes a YAML path is rejected by the drift gate.

**Performance**
- Drift check runtime ≤ 30 s in CI.

---

### C4. Pagination, sorting, and filtering conventions

**What prompt would you run to complete this task?**
"Implement shared pagination/sort/filter primitives and DTOs to be reused across all list endpoints."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/src/pagination/cursor.ts`
- `libs/contracts/src/pagination/page.dto.ts`
- `libs/contracts/src/filters/range.dto.ts`

**What function do you want to CREATE or UPDATE?**
- `encodeCursor(payload)` / `decodeCursor(token)` (signed, opaque).
- `class PageQueryDto { cursor?: string; limit?: number }`.

**What are details you want to add to drive the code changes?**
- Cursor payload is `{ k: (sortKey, ulid), v: 1 }` signed with HMAC-SHA256 using a service-local secret; tampered cursors are rejected with `400 pagination.invalid_cursor`.
- `limit` validator: integer in `[1, 100]`, default `20`.
- Sortable fields are declared per-endpoint as a constant tuple (`['createdAt:desc'] as const`); the controller rejects any other value with `422 query.invalid_sort`.

**Acceptance Criteria**
- All list endpoints (A5, A7, A12 search, B2 audit search) share the same DTOs and cursor format.
- A property-based test confirms stable ordering and absence of duplicates across random inserts.

**Edge Cases**
- A cursor produced by service A is replayed against service B: rejected by HMAC scope-key mismatch.
- Pagination across a clock-skew boundary (ULID prefix shift): ULID's monotonic generator keeps ordering correct; a test covers two adjacent ULIDs created at clock-tick boundaries.

**Verification**
- 10,000-iteration property-based test seeded for reproducibility in CI.

**Performance**
- Cursor encode/decode p99 ≤ **0.1 ms**.

---

### C5. Idempotency-Key middleware

**What prompt would you run to complete this task?**
"Implement a shared NestJS middleware that enforces, persists, and replays `Idempotency-Key` on every non-GET route per the rules in Part A's Implementation Notes."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/src/idempotency/middleware.ts`
- `services/*/migrations/00xx_create_idempotency_keys.sql`

**What function do you want to CREATE or UPDATE?**
- `IdempotencyMiddleware.use(req, res, next)`.

**What are details you want to add to drive the code changes?**
- Storage: a per-service `idempotency_keys` table with `(key, user_id, route, request_hash, response_status, response_body BYTEA, response_headers JSONB, created_at, expires_at)`. TTL = 24 h.
- `request_hash = SHA256(canonical_json({ method, path, query, body, userId }))`. Different body with same key → `422 idempotency.body_mismatch`.
- Concurrent retries with the same key: the middleware acquires a Postgres advisory lock keyed by `hash(key + route + userId)` so only one handler actually runs.

**Acceptance Criteria**
- A replay returns byte-identical response body and headers within the 24-h window.
- A concurrent burst of 50 identical requests results in exactly **one** downstream effect (e.g., one Stripe card).

**Edge Cases**
- Key is well-formed but for a different user (cross-user replay): treated as a fresh request; per-user namespacing is enforced.
- Body mismatch on a route where bodies legitimately vary by client clock (e.g., timestamps): clients are instructed (in docs) to omit clock fields from idempotency-keyed bodies; the API does not strip fields server-side.

**Verification**
- Load test: 50 concurrent requests with the same key and body produce one effect; verified by counting outbox events and downstream side effects.

**Performance**
- Middleware overhead p95 ≤ **8 ms** (Postgres advisory lock + index hit).

---

### C6. Correlation-Id propagation middleware

**What prompt would you run to complete this task?**
"Implement an interceptor/middleware that reads or generates `X-Correlation-Id`, attaches it to the request context, every log line, every emitted event, and every outbound HTTP/Kafka header."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/src/correlation/middleware.ts`
- `libs/contracts/src/correlation/context.ts`

**What function do you want to CREATE or UPDATE?**
- `CorrelationMiddleware.use(req, res, next)`.
- `withCorrelation(id, fn)` — Node `AsyncLocalStorage` helper.

**What are details you want to add to drive the code changes?**
- Inbound `X-Correlation-Id` is accepted if it matches `^[0-9A-HJKMNP-TV-Z]{26}$` (ULID); otherwise a new one is generated and the inbound value is **not** echoed.
- Outbound headers on internal HTTP and Kafka producer headers carry the same id.

**Acceptance Criteria**
- A test that calls the user BFF and traces through Kafka into the consumer sees the same `correlationId` end-to-end.

**Edge Cases**
- Malicious inbound id with `";DROP TABLE`: regex rejects it; the generated id is used instead. A counter `invalid_correlation_id_total` increments.

**Verification**
- Integration test asserts the id appears in audit logs, outbox events, and notification dispatch metadata.

**Performance**
- Overhead p99 ≤ **0.2 ms**.

---

### C7. Security headers and CORS policy

**What prompt would you run to complete this task?**
"Set the canonical security-header set and CORS allow-list across both BFFs via a global middleware."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/src/security/headers.middleware.ts`
- `services/bff-user/src/main.ts`
- `services/bff-internal/src/main.ts`

**What function do you want to CREATE or UPDATE?**
- `SecurityHeadersMiddleware.use(req, res, next)`.

**What are details you want to add to drive the code changes?**
- Headers (all responses):
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy: geolocation=(), camera=(), microphone=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Resource-Policy: same-origin`
- CORS: explicit allow-list of first-party origins per environment; `allow_credentials = true` only for first-party; `OPTIONS` preflight cached 24 h.

**Acceptance Criteria**
- An automated headers scan (`zap-baseline`) reports no missing security headers.
- A cross-origin request from a non-allow-listed origin is rejected with `403`.

**Edge Cases**
- Allow-list typo (e.g., missing port): CI fails the deploy because the allow-list is validated against a known set in `infra/`.

**Verification**
- Headers contract test asserts every header is present on a sample of routes.

**Performance**
- Header set p99 ≤ **0.1 ms**.

---

### C8. Session authentication and MFA challenge endpoints

**What prompt would you run to complete this task?**
"Implement session-cookie authentication for end-users with a paired MFA challenge endpoint that issues the `scaProof` consumed by Task B1."

**What file do you want to CREATE or UPDATE?**
- `services/bff-user/src/auth/auth.controller.ts`
- `services/bff-user/src/auth/session.guard.ts`
- `services/bff-user/src/auth/mfa.controller.ts`

**What function do you want to CREATE or UPDATE?**
- `AuthController.login(body)`, `AuthController.logout()`, `AuthController.refresh()`.
- `MfaController.challenge(body)` returning `scaProof`.

**What are details you want to add to drive the code changes?**
- Cookies: `HttpOnly; Secure; SameSite=Strict; Path=/`. Session id is a ULID; bound server-side to user + device fingerprint hash.
- Sliding session: 30-minute inactivity, 12-hour absolute. Rotating session id on every privilege escalation (login, MFA success).
- MFA channels: TOTP and FIDO2. The challenge endpoint returns a `scaProof` JWT signed by `identity-svc` with `aud='lumen-bff-user'`, `iat`, `exp = iat + 300`, `jti`, `level ∈ {STANDARD, STRONG}`.

**Acceptance Criteria**
- A request without the session cookie to a protected route returns `401 auth.required`.
- An MFA-step-up flow ends with a `scaProof` whose `jti` is single-use against any one sensitive endpoint.

**Edge Cases**
- Concurrent logins from two devices: both are allowed; logout-from-all revokes all session ids.
- Session id replay from an unrecognized device fingerprint: rejected with `401 auth.device_mismatch` and audit event.

**Verification**
- E2E: login → reveal-PAN attempt (no MFA) returns `401 sca.required` → MFA challenge → reveal-PAN succeeds.

**Performance**
- Session validation p99 ≤ **5 ms** (Redis lookup).

---

### C9. SDK generation from OpenAPI

**What prompt would you run to complete this task?**
"Generate a typed TypeScript SDK from `bff-user.yaml` into `libs/sdk-ts/`, publish to the internal npm registry on tagged releases, and consume it from the user web app."

**What file do you want to CREATE or UPDATE?**
- `tools/sdk-gen/config.yaml`
- `libs/sdk-ts/package.json`
- `.github/workflows/sdk-publish.yml`

**What function do you want to CREATE or UPDATE?**
- N/A (generator config + publish pipeline).

**What are details you want to add to drive the code changes?**
- Generator: `openapi-typescript` (types) + `openapi-fetch` (runtime). No Axios; no class-based generators.
- The SDK emits the deprecation warning from Task C1 when a deprecated route is called.

**Acceptance Criteria**
- A tagged release of `bff-user.yaml` produces a versioned SDK package `@lumen/sdk-ts@x.y.z`.
- Importers cannot accidentally call internal endpoints (`bff-internal` SDK is published separately to a restricted scope).

**Edge Cases**
- A breaking SDK release requires a major version bump and a migration note (mirrors C1).

**Verification**
- A "consumer" smoke project imports the SDK and compiles successfully.

**Performance**
- SDK build ≤ 60 s in CI.

---

### C10. Mock server for offline development

**What prompt would you run to complete this task?**
"Run Prism against `bff-user.yaml` and `bff-internal.yaml` in `make dev` so frontend engineers can develop without backend services running."

**What file do you want to CREATE or UPDATE?**
- `docker-compose.dev.yaml` (extends Task A15)
- `tools/mock/responses/*.json`

**What function do you want to CREATE or UPDATE?**
- N/A (Prism configuration + response examples).

**What are details you want to add to drive the code changes?**
- Provide named examples in OpenAPI for every endpoint's success and primary failure cases.
- Mock responses include realistic `correlationId` and (mocked) `error.code` values.

**Acceptance Criteria**
- A frontend can develop the card-issuance flow with no backend running and the mock server providing realistic latency (200–600 ms variable).

**Edge Cases**
- A path missing examples falls back to schema-derived dummy data; CI warns if any non-trivial route lacks an example.

**Verification**
- Smoke test: `curl` against Prism for each route returns shape-valid responses.

**Performance**
- Mock-server cold start ≤ 5 s.

---

### C11. Partner-API readiness (signed webhooks and API keys) — held behind a flag

**What prompt would you run to complete this task?**
"Specify the partner API surface: API-key authentication, scoped permissions, signed outbound webhooks, and a separate rate-limit profile. Implement the spec stub and disable activation by default."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/openapi/partner-api.yaml`
- `services/bff-partner/` (scaffold; flagged off)
- `docs/partner-api-signing.md`

**What function do you want to CREATE or UPDATE?**
- N/A in MVP; specification + scaffold only.

**What are details you want to add to drive the code changes?**
- Authentication: `Authorization: Bearer pk_<environment>_<rand>`; keys are bound to a tenant, scoped to a permission set, and rate-limited per-tenant.
- Outbound webhooks signed with HMAC-SHA256, header `Lumen-Signature: t=<unix>, v1=<hex>`; 5-minute tolerance; secret rotation supported by accepting two valid secrets during the rotation window (mirrors B6).
- Feature flag `partners.enabled = false` in all environments at MVP; flipping requires compliance sign-off.

**Acceptance Criteria**
- The spec is reviewed by Compliance; the flag flip is gated by a code-owner approval.
- A contract test asserts no `bff-partner` route is reachable in any environment while the flag is off.

**Edge Cases**
- A partner key is leaked: the rotation procedure (key revocation + secret rotation) is documented and rehearsed in a drill (Task B9 runbook catalog).

**Verification**
- Negative integration test: with flag off, every partner route returns `404`.

**Performance**
- N/A in MVP.

---

### C12. Conditional GET (ETag) for read endpoints

**What prompt would you run to complete this task?**
"Add weak ETag support to read endpoints in `bff-user` and `bff-internal` where the underlying data is cheap to hash (card detail, card list, dispute detail). Honor `If-None-Match` and return `304` when applicable."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/src/http/etag.interceptor.ts`
- `services/bff-user/src/cards/cards.controller.ts` (decorator usage)

**What function do you want to CREATE or UPDATE?**
- `EtagInterceptor.intercept(ctx, next)`.

**What are details you want to add to drive the code changes?**
- ETag = `W/"<sha256(canonical_json(body))>"`. Mutating endpoints set `Cache-Control: no-store`.
- Apply only to routes with a `@CacheableRead({ maxAge: 10 })` decorator; **never** apply to reveal, audit, or anything in `sensitive-routes.yaml`.

**Acceptance Criteria**
- A second GET with `If-None-Match` matching the prior response receives `304` with empty body.
- Reveal and audit endpoints never set ETag.

**Edge Cases**
- ETag collision (unrealistic at SHA256, but specified): defaults to `200` rather than `304` if the body cannot be regenerated identically.

**Verification**
- Snapshot test of headers across a representative set of cacheable and non-cacheable routes.

**Performance**
- ETag computation p99 ≤ **0.5 ms** for typical card-detail payloads.

---

### C13. Request and response size limits

**What prompt would you run to complete this task?**
"Enforce per-route maximum request and response sizes; reject oversized requests with `413` and truncate or paginate oversized responses with a clear contract."

**What file do you want to CREATE or UPDATE?**
- `libs/contracts/src/http/size-limit.guard.ts`
- `libs/contracts/openapi/*.yaml`

**What function do you want to CREATE or UPDATE?**
- `SizeLimitGuard.canActivate(ctx)`.

**What are details you want to add to drive the code changes?**
- Defaults: requests ≤ **64 KB**; multipart uploads (dispute evidence) ≤ **5 MB** per file; responses paginated so a single page ≤ **256 KB** (excluding examples).
- Limits declared per route in OpenAPI via `x-lumen-max-body` and validated against the guard's configuration in CI.

**Acceptance Criteria**
- A `66 KB` JSON request to any non-upload route is rejected with `413 body.too_large`.
- A list response that would exceed 256 KB returns a partial page with `nextCursor`.

**Edge Cases**
- Multipart upload exceeding 5 MB: client receives `413` before the connection is fully buffered.

**Verification**
- Load test sends boundary-condition payloads; assert correct status codes.

**Performance**
- Guard overhead p99 ≤ **0.1 ms**.

---

# Part D — Testing Specification Template (Lumen Cards)

> Ingest the information from this file, implement the Low-Level Tasks, and generate the code that will satisfy the High and Mid-Level Objectives.

## High-Level Objective

- Build a layered, automated, and compliance-aware test suite that gives the Lumen Cards team objective evidence that Parts A, B, and C are correct, secure, and within SLO — and that gives an AI coding partner an unambiguous bar for "done".

## Mid-Level Objectives

1. **Unit tests for the domain core.** FSM, validators, mappers, idempotency, error envelope, and the audit hash chain are unit-tested with high coverage and deterministic seeds.
2. **Integration tests against real dependencies.** PostgreSQL, Redis, Kafka, Stripe Issuing sandbox, and S3 are exercised via Testcontainers and the Stripe test API; tests cover at-least-once delivery, outbox publishing, and webhook idempotency.
3. **Contract tests.** OpenAPI is the source of truth; controllers, generated SDK, and mock server all conform.
4. **End-to-end smoke and recovery flows.** Happy-path issuance through dispute is covered; recovery from each documented failure mode (Stripe outage, webhook replay, RDS failover) is exercised.
5. **Property-based testing for invariants.** Pagination stability, FSM closure, idempotency replay, monetary arithmetic correctness, and audit-chain integrity are property-tested with shrinking and reproducible seeds.
6. **Performance and load benchmarks.** SLOs from Part B are continuously verified by `k6` scenarios in a pre-prod environment; performance regressions fail merge.
7. **Security tests.** SCA replay, webhook signature tampering, RBAC matrix completeness, log-leak denylist, security-headers conformance.
8. **Compliance tests.** Audit chain integrity, GDPR erasure proof, retention policy correctness, data-residency policy compliance, key-inventory completeness.
9. **Chaos / fault-injection.** Stripe sandbox unavailability, Kafka broker loss, Redis eviction, PostgreSQL primary failover; system behavior matches documented expectations.
10. **CI gates and reporting.** A single `make test-all` runs the categorized suite; coverage, mutation score, performance trends, and security results are visible per PR.

## Implementation Notes

- **Language stack.** Jest (`ts-jest`) for unit & service-level integration; `supertest` for HTTP; `@testcontainers/postgresql`, `@testcontainers/redis`, `@testcontainers/kafka` for spin-up; `fast-check` for property-based tests; `k6` for performance; `stryker-mutator` for mutation testing; `pact` (or in-house) for OpenAPI contract tests.
- **Fixtures.** Centralized factories in `libs/test-fixtures/` produce ULID-stable, locale-neutral fixtures. Fixtures are **never** loaded from cold YAML/JSON unless mirroring an external API (Stripe events).
- **Stripe sandbox.** Tests against Stripe's sandbox are tagged `@stripe-sandbox` and run only when `STRIPE_TEST_KEY` is present; CI runs them in a dedicated environment with a rotating sandbox key.
- **Determinism.** All non-deterministic inputs (time, randomness, ULIDs) are injected via interfaces; tests set seeds and `Date.now()` shims.
- **Coverage.** Targets restated from Part B: ≥ 85% line / 90% branch on `cards-svc`/`disputes-svc` domain layers; ≥ 70% on BFFs. Coverage is enforced per-package in CI.
- **Performance gating.** A k6 nightly run produces JSON results; a script compares latency p95/p99 to declared budgets and fails CI when a regression > 10% occurs over a 7-day rolling window.
- **Security testing scope.** Tests cover **our code**, not Stripe's. Stripe-side concerns (TLS, PAN storage) are not retested but are referenced in the PCI scoping document (`docs/pci-scope.md`).
- **Compliance evidence.** Each compliance test emits a machine-readable artifact (`compliance-evidence-*.json`) consumed by Compliance reporting; outputs are retained for the documented audit period.
- **Test data privacy.** No real user data ever in tests. Property tests generate synthetic data; integration tests generate disposable users via `identity-svc`'s test API.

## Context

### Beginning context

- Parts A, B, and C beginning contexts apply.
- A `libs/test-fixtures/` placeholder exists.
- A `make test` script exists that runs `jest` per service but has no shared configuration.

### Ending context

- A shared Jest configuration (`tools/jest/preset.cjs`) used by all services with a common reporter and coverage thresholds.
- A `make test-all` target that runs: lint, unit, integration, contract, property, security, compliance, and (on nightly) performance and chaos.
- A `tools/coverage-merge/` step that aggregates per-service coverage into a single report.
- A `tools/perf/` k6 project with versioned scenarios per SLO from Part B.
- A `tools/compliance/` toolset producing evidence artifacts for audit chain verification, GDPR-erasure proofs, and retention.
- A nightly chaos pipeline executing scripted faults against a staging environment.

## Low-Level Tasks (Part D)

> Numbering continues. Same extended task format.

### D1. Unit-test scaffolding and coverage gates

**What prompt would you run to complete this task?**
"Establish a shared Jest preset with strict TypeScript settings, coverage thresholds, and a deterministic clock/ULID shim; wire per-package thresholds."

**What file do you want to CREATE or UPDATE?**
- `tools/jest/preset.cjs`
- `tools/jest/shims/time.ts`
- `tools/jest/shims/ulid.ts`
- `services/*/jest.config.cjs`

**What function do you want to CREATE or UPDATE?**
- `installDeterministicShims()`.

**What are details you want to add to drive the code changes?**
- Coverage thresholds: domain ≥ 85% line / 90% branch; BFFs ≥ 70% / 75%; libs ≥ 90% / 95%.
- Time and ULID shims are installed in `beforeEach`; reset in `afterEach`.

**Acceptance Criteria**
- A unit test asserting `Date.now()` returns a fixed value passes deterministically.
- Coverage thresholds are enforced; reducing coverage on a domain file below threshold fails CI.

**Edge Cases**
- A test that legitimately needs real time uses `withRealTime(fn)` helper; documented in `docs/testing.md`.

**Verification**
- Snapshot test of `preset.cjs` config.

**Performance**
- N/A (build-time).

---

### D2. Integration test environment with Testcontainers

**What prompt would you run to complete this task?**
"Bring up disposable PostgreSQL, Redis, and Kafka containers per integration test suite; run migrations; tear down cleanly."

**What file do you want to CREATE or UPDATE?**
- `tools/integration/postgres.container.ts`
- `tools/integration/redis.container.ts`
- `tools/integration/kafka.container.ts`
- `services/*/test/integration/setup.ts`

**What function do you want to CREATE or UPDATE?**
- `startPostgres()`, `startRedis()`, `startKafka()`, `migrateService(svc)`.

**What are details you want to add to drive the code changes?**
- Image versions pinned (e.g., `postgres:16.4`, `redis:7.4`, `confluentinc/cp-kafka:7.6.0`).
- Per-suite isolation: each suite gets a unique database name; cleanup is automatic.
- Network mode constrained to localhost; no external pulls in CI beyond the test registry.

**Acceptance Criteria**
- Running the integration suite in parallel does not produce DB cross-talk.
- Container startup time p95 ≤ **15 s** on the CI runner.

**Edge Cases**
- Containers fail to start (Docker not running): the test runner emits a clear, actionable error and skips integration suites unless `REQUIRE_INTEGRATION=1`.

**Verification**
- A parallel-suite stress test runs 8 suites in parallel; all pass.

**Performance**
- Suite warm-up p95 ≤ **15 s**.

---

### D3. Stripe Issuing sandbox harness and recorded fixtures

**What prompt would you run to complete this task?**
"Build a harness that runs against Stripe's Issuing sandbox for connectivity tests and replays recorded fixtures otherwise; cover authorization, capture, refund, decline, and dispute lifecycle events."

**What file do you want to CREATE or UPDATE?**
- `tools/stripe-fixtures/recorder.ts`
- `tools/stripe-fixtures/replayer.ts`
- `tools/stripe-fixtures/recordings/*.json`

**What function do you want to CREATE or UPDATE?**
- `recordSession(scenario)`, `replaySession(scenario)`.

**What are details you want to add to drive the code changes?**
- Recordings are stripped of PAN/CVV/expiry at record time (denylist filter); only Stripe object ids and last4 remain.
- Replay mode is the default in CI; record mode requires `STRIPE_TEST_KEY` and a `--record` flag.
- Scenarios: `issuance-happy`, `issuance-stripe-5xx`, `freeze-unfreeze-cycle`, `limits-update`, `replace-card`, `authorize-then-decline`, `authorize-then-capture-then-refund`, `dispute-open-evidence-status-changes`.

**Acceptance Criteria**
- A recorded fixture replay reproduces the same projection state as a live sandbox run.
- Fixture files are diffable and contain no PCI-scope-impacting fields.

**Edge Cases**
- Stripe sandbox changes a response shape: the replayer signals a drift; a maintainer re-records with the new shape and reviews diff.

**Verification**
- A nightly job re-runs the live sandbox path and compares to the latest recordings.

**Performance**
- Replay p95 ≤ **1 s** per scenario.

---

### D4. Contract tests: OpenAPI ↔ controllers ↔ SDK ↔ mock server

**What prompt would you run to complete this task?**
"Validate that every controller method matches its OpenAPI definition; that the generated SDK calls match the same schema; and that the Prism mock server's example responses also validate."

**What file do you want to CREATE or UPDATE?**
- `tools/contract-tests/runner.ts`
- `tools/contract-tests/cases/*.ts`

**What function do you want to CREATE or UPDATE?**
- `validateRequestResponsePair(path, method, fixture)`.

**What are details you want to add to drive the code changes?**
- For every (path, method, status) triple in OpenAPI, generate at least one positive and one negative test case using the YAML's examples.
- Validate request bodies against the operation's request schema; validate responses against the operation's status schema.

**Acceptance Criteria**
- A schema change without a controller change fails CI.
- A controller change without a schema change fails CI (mirrors C3).

**Edge Cases**
- Polymorphic responses (e.g., `oneOf` errors): all branches must have at least one validating fixture.

**Verification**
- A synthetic mutation in a DTO causes the suite to fail with a targeted error message.

**Performance**
- Full suite ≤ **60 s**.

---

### D5. Property-based tests for FSM, pagination, idempotency, monetary math

**What prompt would you run to complete this task?**
"Use `fast-check` to assert structural invariants: only legal FSM transitions occur, pagination is stable under random inserts, idempotency replay produces identical responses, and minor-unit arithmetic does not lose precision."

**What file do you want to CREATE or UPDATE?**
- `services/cards-svc/test/property/fsm.property.spec.ts`
- `libs/contracts/test/property/pagination.property.spec.ts`
- `libs/contracts/test/property/idempotency.property.spec.ts`
- `libs/contracts/test/property/money.property.spec.ts`

**What function do you want to CREATE or UPDATE?**
- Test specs using `fc.assert`.

**What are details you want to add to drive the code changes?**
- Seeds are fixed in CI for reproducibility; failures print the shrunk counterexample and the seed.
- Iterations: 10,000 per property in CI; 100,000 nightly.
- Monetary properties: associativity/commutativity of addition on `bigint` minor units; rounding edge cases for half-even rounding (used only when needed).

**Acceptance Criteria**
- Each property test passes for ≥ 10,000 iterations with the canonical seed.
- A deliberate bug (e.g., float arithmetic) is caught by `money.property.spec.ts`.

**Edge Cases**
- Shrunk counterexamples involving Unicode names (nicknames) — verify our normalization handles them.

**Verification**
- Mutation-injection on the FSM file produces a failure within ≤ 1 minute.

**Performance**
- CI suite total ≤ **2 minutes**; nightly ≤ **20 minutes**.

---

### D6. End-to-end happy-path and recovery-flow tests

**What prompt would you run to complete this task?**
"Drive a full lifecycle E2E from create → limits → freeze → unfreeze → authorize → view txn → dispute → replace → close; then drive recovery flows for documented failure modes."

**What file do you want to CREATE or UPDATE?**
- `tools/e2e/scenarios/lifecycle.spec.ts`
- `tools/e2e/scenarios/recovery-stripe-outage.spec.ts`
- `tools/e2e/scenarios/recovery-kafka-loss.spec.ts`
- `tools/e2e/scenarios/recovery-rds-failover.spec.ts`

**What function do you want to CREATE or UPDATE?**
- E2E scenario functions; helpers in `tools/e2e/helpers/`.

**What are details you want to add to drive the code changes?**
- Tests run against `make dev` for local fast feedback and against the staging environment in nightly CI.
- Recovery tests use a fault-injection harness (D10) to induce the failure and assert the documented user-visible and audit-visible outcomes.

**Acceptance Criteria**
- The happy-path E2E completes in ≤ **3 minutes** locally.
- Each recovery test produces the documented `error.code` and an `internal.warning.v1` audit event.

**Edge Cases**
- A flaky Stripe sandbox response: the test retries deterministically; flake budget is monitored and a quarantine label automatically applied above threshold.

**Verification**
- E2E pass rate on `main` ≥ 99% over a rolling 30-day window.

**Performance**
- Happy-path runtime p95 ≤ **3 min**; full E2E suite ≤ **20 min**.

---

### D7. Performance and load benchmarks (k6)

**What prompt would you run to complete this task?**
"Write k6 scenarios that drive the user API and the webhook ingestion path at growth-tier load and compare measured latency/throughput to the SLO budgets from Part B."

**What file do you want to CREATE or UPDATE?**
- `tools/perf/scenarios/user-api.k6.js`
- `tools/perf/scenarios/webhook-ingest.k6.js`
- `tools/perf/check/check-slo.ts`

**What function do you want to CREATE or UPDATE?**
- k6 scenarios; an `check-slo` script that fails CI on regression.

**What are details you want to add to drive the code changes?**
- Growth-tier targets: ~500 auth/sec sustained on webhook ingest; p95 projection lag ≤ 2 s; user API mutating p95 ≤ 800 ms.
- Regression rule: a 10% degradation in p95 over a 7-day window fails the nightly job and opens a tracking issue.

**Acceptance Criteria**
- Nightly perf run produces a per-scenario JSON; trend dashboards reflect the latest run.
- A deliberate slowdown (e.g., a 200 ms sleep) is detected in the next nightly run.

**Edge Cases**
- Background noise on the staging environment: tests average over 3 runs and discard outliers > 2σ.

**Verification**
- A synthetic regression injected via feature flag triggers the check-slo failure.

**Performance**
- Nightly perf suite ≤ **45 min**.

---

### D8. Security tests (SCA, signatures, RBAC, log-leak denylist)

**What prompt would you run to complete this task?**
"Implement automated security tests for SCA replay/staleness, Stripe webhook signature tampering, RBAC matrix completeness, and log-output denylist enforcement."

**What file do you want to CREATE or UPDATE?**
- `tools/security/sca.spec.ts`
- `tools/security/webhook-signature.spec.ts`
- `tools/security/rbac-matrix.spec.ts`
- `tools/security/log-denylist.spec.ts`

**What function do you want to CREATE or UPDATE?**
- Security spec files; logger spy fixture.

**What are details you want to add to drive the code changes?**
- SCA tests reuse Task B1's freshness window and assert correct `error.code` for each failure mode.
- RBAC matrix test enumerates every (role × endpoint × method) triple from `permissions.matrix.ts` and asserts the expected allow/deny outcome.
- Log denylist test runs each request through a logger spy and asserts no banned key appears in any captured line.

**Acceptance Criteria**
- A new sensitive route added without `@ScaRequired` is caught by the SCA test (`sensitive-routes.yaml` check).
- A logger statement adding a banned key is caught by the denylist test.

**Edge Cases**
- A new role added without an entry in the matrix: the test fails with a list of missing pairs.

**Verification**
- Suite runs on every PR; cannot be skipped via labels.

**Performance**
- Full security suite ≤ **3 minutes**.

---

### D9. Compliance tests (audit chain, GDPR erasure, retention)

**What prompt would you run to complete this task?**
"Verify the audit-log hash chain on a multi-million-row fixture; assert GDPR erasure produces the documented redaction artifact; verify retention policies on S3 and RDS."

**What file do you want to CREATE or UPDATE?**
- `tools/compliance/audit-chain.spec.ts`
- `tools/compliance/gdpr-erasure.spec.ts`
- `tools/compliance/retention.spec.ts`

**What function do you want to CREATE or UPDATE?**
- Compliance spec files; CLI `verify-chain` shared with Task B2.

**What are details you want to add to drive the code changes?**
- Audit chain test seeds 1M rows and asserts verification in ≤ 30 s (matches B2's performance budget).
- GDPR erasure test runs Task B3 end-to-end on a synthetic user and validates the redaction proof and that the audit chain still verifies after.
- Retention test checks S3 Object Lock configuration via the AWS SDK and asserts the documented retention periods.

**Acceptance Criteria**
- Each test produces a machine-readable `compliance-evidence-<test>.json` artifact retained for the audit period.
- Tests run weekly in CI and on every release candidate.

**Edge Cases**
- A retention misconfiguration on a non-prod bucket: the test fails with the specific bucket name and the expected vs actual configuration.

**Verification**
- The artifact format is consumed by the Compliance reporting pipeline (out of scope for this homework, but the contract is fixed).

**Performance**
- Suite total ≤ **5 minutes**.

---

### D10. Chaos / fault-injection

**What prompt would you run to complete this task?**
"Build a fault-injection harness that simulates Stripe sandbox unavailability, Kafka broker loss, Redis eviction, and PostgreSQL primary failover against a staging environment; assert documented runbook outcomes."

**What file do you want to CREATE or UPDATE?**
- `tools/chaos/scenarios/*.yaml`
- `tools/chaos/runner.ts`

**What function do you want to CREATE or UPDATE?**
- `runChaosScenario(spec)`.

**What are details you want to add to drive the code changes?**
- Scenarios are declarative YAML: target, action (drop traffic, kill pod, fail DNS), duration, expected observations (metrics, alerts, audit events).
- Runs nightly against staging; on-call is **not** paged for these runs (alerts go to a chaos channel).

**Acceptance Criteria**
- Each scenario's expected observations are seen; missing observations fail the run with diagnostics.
- A new runbook is acceptable only when paired with at least one chaos scenario validating it.

**Edge Cases**
- A scenario inadvertently exceeds its blast radius (e.g., kills more pods than intended): a circuit breaker stops the run and pages on-call.

**Verification**
- Quarterly chaos drill (Task B9) consumes these scenarios.

**Performance**
- Each scenario ≤ **15 minutes** wall time.

---

### D11. Mutation testing (advisory, not blocking)

**What prompt would you run to complete this task?**
"Run Stryker mutation testing on the domain layers nightly; report mutation score trends; advisory-only at MVP."

**What file do you want to CREATE or UPDATE?**
- `tools/mutation/stryker.conf.json`
- `.github/workflows/mutation-nightly.yml`

**What function do you want to CREATE or UPDATE?**
- N/A (config).

**What are details you want to add to drive the code changes?**
- Target packages: `cards-svc/src/domain`, `disputes-svc/src/domain`, `audit-svc/src/domain`.
- Reported as a trend; declines > 5 points week-over-week create a tracking issue.

**Acceptance Criteria**
- Nightly report posted to the engineering channel; advisory issue opened on regression.

**Edge Cases**
- A mutation produces an infinite loop: timeout per mutant set to 30 s; the mutant is reported as `Timeout`.

**Verification**
- A test reduction (deleting a critical test) reflects in the next mutation score.

**Performance**
- Nightly run ≤ **2 hours**.

---

### D12. CI pipeline and test gating

**What prompt would you run to complete this task?**
"Compose the test categories into a single PR pipeline with stage gating; configure nightly extended runs; surface results in PR comments and a dashboard."

**What file do you want to CREATE or UPDATE?**
- `.github/workflows/pr.yml`
- `.github/workflows/nightly.yml`
- `tools/ci/reporters/comment.ts`

**What function do you want to CREATE or UPDATE?**
- PR comment renderer; coverage and SLO summarizers.

**What are details you want to add to drive the code changes?**
- PR pipeline stages (in order, with required outcomes): lint → unit → contract → integration → property → security → compliance.
- Nightly stages: performance → mutation → chaos → e2e-full.
- Gate: PRs cannot merge without all PR stages green; admins can override only with a documented justification in the PR body.

**Acceptance Criteria**
- A PR introducing a failing test in any stage is blocked from merge.
- The PR comment shows coverage delta, contract drift summary, and security findings (if any).

**Edge Cases**
- CI runner outage: a "skip" label cannot bypass required stages; the PR waits.

**Verification**
- A synthetic PR exercises every stage.

**Performance**
- PR pipeline p95 ≤ **15 minutes**.

---

# Part E — Prompt Engineering Best Practices (Lumen Cards Edition)

> This section is reference material for any AI coding partner contributing to Lumen Cards. It is **not** a feature spec; it has no Low-Level Tasks. The rules below apply on top of (not instead of) `agents.md` and the editor rules in `.cursor/rules/`. When a prompt instruction conflicts with the spec, the spec wins.

## E.1 Effective Prompt Structure

Every prompt issued to an AI coding partner for Lumen Cards should be structured in this order:

1. **Context** — what Lumen Cards is, which bounded context the task lives in, and which Part(s) and Task ID(s) (e.g., A2, B1, C5) constrain the work.
2. **Task** — a single, scoped change with an unambiguous deliverable. If the change spans multiple Task IDs, split the prompt.
3. **Constraints** — the non-negotiables: PCI-out-of-CDE, GDPR pseudonymization, idempotency, audit, SCA, money-as-minor-units, no `any`, no `console.log`. Cite the Task ID that imposes the constraint.
4. **Examples** — at least one positive example (canonical correct output shape) and, when behavior under failure matters, one negative example (what the output must **not** look like).
5. **Output Format** — explicit (e.g., "produce the NestJS controller in `services/cards-svc/src/...` and the matching test under `test/unit/...`; do not produce a README").

## E.2 Specific Prompt Guidelines

For every prompt on Lumen Cards, mention — by reference to the relevant Task ID — at least the items below that apply:

- **Compliance:** which regulation (GDPR, PSD2 SCA, PCI DSS scoping, EBA outsourcing) governs the change; cite the Mid-Level Objective in Part B that the change advances.
- **Security:** RBAC role(s) involved (`OPS`, `SUPPORT`, `FRAUD`, end-user); SCA freshness (B1) if a sensitive action.
- **Data privacy:** GDPR lawful basis; whether personal data leaves the platform; whether pseudonymization (B4) applies.
- **Audit trail:** which audit event(s) must be emitted (B2); whether the event is in the "essential consumer" allow-list.
- **Error handling:** which `error.code` from the C2 catalog the change introduces or reuses; localization keys updated.
- **Idempotency:** confirm the route is non-GET and uses C5's middleware; specify the `request_hash` body shape.
- **Testing:** which D-stage(s) must pass (unit, integration, property, security, compliance, perf); explicit acceptance criteria.

## E.3 Common Prompt Patterns

Each pattern below is a template; replace the bracketed placeholders. The patterns are intentionally aligned with the extended task format used in Parts A–D.

### Code Generation

```text
Context: Lumen Cards, [bounded context, e.g., cards-svc]. Constraints from Parts A/B/C: [Task IDs, e.g., A3, B1, C5].

Create a [function/class/controller method] that [specific functionality]:

Requirements:
- [Functional requirement 1, e.g., "transitions card to FROZEN and persists with optimistic lock"]
- [Functional requirement 2]
- [Functional requirement 3]

Non-functional (do not violate):
- No PAN/CVV/expiry in code, logs, traces, or DTOs (B-Implementation-Notes).
- Monetary fields are BIGINT minor units; no floats.
- Idempotency via the shared middleware (C5); produce the route with `Idempotency-Key` declared in OpenAPI.
- Emit audit event [event name, e.g., card.frozen.v1] via the outbox (A13, B2).
- All errors use the C2 envelope with code [e.g., card.illegal_transition].

Include:
- The OpenAPI fragment in [path/to/file.yaml].
- Unit tests covering happy path, illegal transition, and version conflict.
- Acceptance criteria: matches Task [ID] in specification.md.

Output format:
- One TypeScript file per artifact; no inline scripts; no README.
```

### Refactoring

```text
Context: Lumen Cards, [bounded context]. Constraints from Part B: [Task IDs].

Refactor [path/to/file.ts] to [specific improvement, e.g., "extract the spending-controls mapping into a pure function for testability"] without changing externally observable behavior.

Requirements:
- Preserve the public contract (OpenAPI fragment unchanged).
- Maintain or improve coverage on the touched module.
- Preserve emitted events and their schema versions.
- Keep all C-conventions intact (error envelope, correlation-id, idempotency).

Forbid:
- Changing route paths or response shapes.
- Removing or renaming exported symbols without a deprecation step.
- Introducing `any` or `console.*` calls.

Output format:
- The refactored file plus updated tests; no behavioral test changes.
```

### Testing

```text
Context: Lumen Cards, [bounded context]. Constraints from Part D: [Task IDs].

Create comprehensive tests for [function/class/route]:

Test categories required:
- Unit (deterministic, no external deps).
- Property-based (where invariants exist; cite the invariant).
- Integration (only if the function touches DB/Kafka/Redis/Stripe).
- Contract (if the change touches OpenAPI).

Test cases must include:
- Happy path with canonical fixture.
- Boundary values (limit min, limit max, empty page, single-element page).
- Edge cases listed in the matching specification.md Task (cite IDs).
- Error conditions producing the expected C2 `error.code`.
- Concurrency / idempotency replay (if applicable).

Output format:
- Test files only; no source code changes; no skipped tests.
```

### Documentation

```text
Context: Lumen Cards, [bounded context].

Generate documentation for [function/class/route]:

Include:
- Purpose (one paragraph), mapped to a Mid-Level Objective in Part A or B (cite).
- Inputs and outputs with concrete examples (use ULIDs, EUR minor units).
- Error codes (from the C2 catalog) and when each is raised.
- Idempotency semantics (cite C5).
- Audit events emitted (cite B2 entry).
- Performance budget (cite the matching Task's Performance section).

Output format:
- One Markdown file under `docs/`; no inline diagrams unless asked.
```
