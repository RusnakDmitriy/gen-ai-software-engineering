# Homework 3 — Specification-Driven Design

**Student:** Dmytro Rusnak
**Course:** Generative AI in Software Engineering — Agentic Workflow
**Topic:** Specification package for a finance-oriented application

---

## Task summary

The deliverable is a **specification package** — not running code — for a finance feature suitable for an EU-regulated environment. I chose **virtual card lifecycle management** (create, freeze/unfreeze, set limits, view transactions, replace, dispute, close, JIT PAN reveal) and shaped it as a neobank-style platform called **Lumen Cards**, backed by Stripe Issuing as the issuer-processor. The product is deliberately designed to keep the platform **out of the PCI cardholder data environment** so that compliance posture flows from the architecture itself rather than from after-the-fact controls.

The four required artifacts are all in this folder:

| # | File | Purpose |
|---|------|---------|
| 1 | [`specification.md`](./specification.md) | Full product spec in five layered parts (A–E), 51 low-level tasks |
| 2 | [`agents.md`](./agents.md) | Operating guide for AI coding partners (Cursor / Copilot / Claude / Codex) |
| 3 | [`.cursor/rules/*.mdc`](./.cursor/rules/) | Eight scoped Cursor rule files (general, security-compliance, backend, api, database, events, testing, infra) |
| 4 | [`README.md`](./README.md) | This file — rationale and best-practice mapping |

---

## How to read the spec (suggested order)

1. **`specification.md` Product Context** (top of file) — shared facts for Parts A–E: stakeholders, regulatory frame, tech baseline, out-of-scope list.
2. **Part A** — product mechanics (15 tasks, A1–A15).
3. **Part B** — compliance / security / audit overlay (11 tasks, B1–B11). Numbering is global and continuous across parts.
4. **Part C** — REST API surface conventions (13 tasks, C1–C13).
5. **Part D** — testing strategy (12 tasks, D1–D12).
6. **Part E** — prompt-engineering best practices for an AI coding partner.
7. **`agents.md`** — operating rules with cross-references back to Task IDs.
8. **`.cursor/rules/*.mdc`** — laconic, file-scoped enforcement of the above.

Every Task in the spec uses an **extended format**: `Prompt / File / Function / Details + Acceptance Criteria + Edge Cases + Verification + Performance`. Every Cursor rule cites the Task ID it derives from, so traceability runs end-to-end: *vision → mid-level objective → implementation note → low-level task → operating rule → file-scoped enforcement*.

---

## Rationale

### Why a layered Parts-A-through-E structure (instead of a flat spec)

The minimal template offered a single high-level / mid-level / low-level / context / tasks shape. I split that into **five layered parts** so each layer has a single concern:

- **Part A** answers *what does the system do?* in product-mechanics terms.
- **Part B** answers *what does "doing it safely in a regulated environment" mean?* — compliance, security, audit, reliability, retention, outsourcing risk.
- **Part C** answers *how is the external surface contracted?* — OpenAPI-first, error envelope, idempotency, pagination, security headers.
- **Part D** answers *how do we know it works?* — categorized test strategy with coverage gates and chaos/compliance evidence.
- **Part E** answers *how should an AI coding partner produce conforming output?* — prompt patterns aligned with the spec.

This separation lets a reader skim by interest (a Compliance reviewer reads B + the §6 of `agents.md`; a frontend engineer reads C + the API rules) and keeps the file navigable even at ~2,200 lines.

### Why neobank-style virtual cards with Stripe Issuing

- **Out-of-CDE by construction.** Stripe Issuing holds the PAN/CVV; the platform stores only `last4`, `brand`, and an opaque `stripe_card_id`. PCI DSS scope is contained by architecture — see [`specification.md` Part B → 6.1 / Task A8](./specification.md), [`agents.md` §6.1](./agents.md), and [`.cursor/rules/security-compliance.mdc`](./.cursor/rules/security-compliance.mdc).
- **EU regulatory fit.** PSD2 SCA, GDPR, and EBA outsourcing guidelines are the dominant constraint set in this segment, so the spec can show meaningful regulatory work without inventing it.
- **Bounded but realistic.** Full lifecycle (issue → freeze → limits → reveal → replace → dispute → close) gives enough surface for ~50 substantive tasks without sprawling into adjacent domains (KYC, AML, ledger, statements — all marked out of scope so the boundary is explicit).

### How I chose performance targets

The TASKS guidance ("if hypothetical, label as **assumed targets** and explain why they are reasonable for FinTech UX or ops") drove the approach.

I anchored every number to one of three references and labelled it as an assumed target in the spec:

1. **User-perception research.** Anything a user waits on synchronously is bounded by the Nielsen thresholds (≤100 ms feels instant, ≤1 s keeps flow uninterrupted). Mutating routes target **p95 ≤ 800 ms**; read routes **p95 ≤ 150 ms** (see Part B §Mid-Level Objective 5 and `infra.mdc`).
2. **Upstream RTT.** Issuance, freeze, replace, reveal — these are dominated by the Stripe Issuing round-trip (~150–400 ms in sandbox). The per-task budgets in Part A (e.g. A2 ≤ 800 ms p95) are Stripe RTT + ~300 ms platform headroom.
3. **Scale-tier calibration.** I chose the **growth tier** (~5M cards, ~500 auth/sec peak, 99.95% SLO) deliberately: it's the inflection point where a startup neobank starts to need real engineering rigor (outbox lag, projection budgets, DR) but is far short of the multi-region, multi-currency complexity of late-stage scale. SLOs (Part B-Mid 5, Task B9) follow Google SRE conventions: error budget + burn-rate alerts (2%/1h fast burn, 10%/3d slow burn).

The authorization-path lag budget (**p95 ≤ 2 s** webhook → user-visible) was calibrated against typical neobank UX expectations: users see push notifications within ~2 s of a swipe, and in-app transaction lists must agree.

### How I chose verification depth

The depth ladder mirrors the cost of bugs in each layer:

| Layer | Test categories required (Part D) | Coverage gate | Why |
|---|---|---|---|
| Domain (`cards-svc`, `disputes-svc`, `audit-svc`) | Unit + property-based + integration | **≥ 85% line / 90% branch** | Bugs here are financial bugs |
| Libs (`libs/contracts`, `libs/events`) | Unit + contract + property | **≥ 90% / 95%** | Used everywhere; one bug ⇒ many bugs |
| BFFs | Unit + contract + E2E | **≥ 70% / 75%** | Thin by design; logic lives upstream |

On top of the per-layer coverage, **mandatory cross-cutting categories** apply to any PR that touches the matching surface (Part D §10.1 in `agents.md` restates this as a table). Specifically:

- **Property-based tests** (`fast-check`) are required wherever an *invariant* exists — FSM transitions, pagination ordering, idempotency replay, monetary arithmetic. These catch the classes of bug that example-based tests almost always miss (Task D5).
- **Compliance tests produce machine-readable evidence** — audit-chain verify, GDPR erasure proof, retention check (Task D9). The Compliance reviewer reads JSON artifacts, not assertions in test names.
- **Chaos / fault-injection runs quarterly** (Tasks B9, D10) — minimum cadence to satisfy the EBA outsourcing-guideline expectation of provider-failure rehearsals.
- **A contract-drift gate (Task C3)** fails CI whenever OpenAPI YAML and a controller disagree, so the public contract literally cannot drift.

This is "verification as documentation" rather than "tests as afterthoughts": every Mid-Level Objective in the spec has at least one matching test category in Part D, and every low-level Task names its own Acceptance Criteria, Edge Cases, Verification, and Performance section.

### Why an `agents.md` plus eight `.mdc` files (instead of one giant rule file)

Cursor / Copilot / Claude all support a long-form operating doc **and** scoped, file-pattern rules. The two have different jobs:

- **`agents.md`** is the long-form reference: 14 sections covering tech stack, repository layout, domain invariants, hard security rules, an edge-case table, idempotency/audit/events checklist, performance/reliability expectations, a Definition-of-Done, a clarification protocol, forbidden behaviors, and a glossary. An agent reads this once when first dropped into the project.
- **`.cursor/rules/*.mdc`** is the in-the-moment enforcement layer: laconic, one concern per file, attached by glob so only the rules that match the file currently open are pulled into context. Two files (`general.mdc`, `security-compliance.mdc`) are `alwaysApply: true` because they bind regardless of file; the other six (`backend`, `api`, `database`, `events`, `testing`, `infra`) are scoped so context isn't wasted.

Splitting by domain/topic (instead of one monolithic `.cursor/rules/all.mdc`) follows the Cursor rule-authoring guidance: *"Under 50 lines · one concern per rule · scoped globs."* Each `.mdc` cross-references the Task IDs from `specification.md` it derives from, so a single source of truth holds and the rule files stay short.

---

## Industry best practices (and where they appear)

Every practice below is grounded in established FinTech / regulated-software conventions. The "Where it appears" column maps the practice to specific Task IDs / files / sections so a reviewer can verify traceability.

### Compliance & regulatory

| Practice | Where it appears |
|---|---|
| **PCI DSS scope containment ("out-of-CDE by design")** — only Stripe-tokenized references stored | `specification.md` Product Context, Part B Implementation Notes, Task A8 (JIT reveal); `agents.md` §6.1; `.cursor/rules/security-compliance.mdc` |
| **PSD2 Strong Customer Authentication** with freshness windows and replay protection | `specification.md` Task B1; `agents.md` §6.3; `.cursor/rules/security-compliance.mdc` (Authn / SCA section) |
| **GDPR lawful-basis register (RoPA)** updated in the same PR as any new personal-data field | `specification.md` Part B Implementation Notes; `agents.md` §6.4 + §6.7; `.cursor/rules/security-compliance.mdc` |
| **GDPR right-to-erasure** with cryptographic proof of action and audit-chain preservation | `specification.md` Task B3 |
| **GDPR pseudonymization on event boundaries** with per-consumer salts in KMS | `specification.md` Task B4; `.cursor/rules/events.mdc` |
| **EU data residency enforced at deploy time** via OPA/Rego policy | `specification.md` Part B Implementation Notes; `.cursor/rules/infra.mdc` |
| **EBA outsourcing guidelines** for critical processors — register, exit plan, contract-tested fake adapter | `specification.md` Task B11 |
| **PCI scoping document and Record of Processing Activities** co-changed with code | `specification.md` Part B Beginning Context; `agents.md` §6.7 |

### Security

| Practice | Where it appears |
|---|---|
| **Logging denylist** for PAN/CVV/secrets/sessions enforced by a wrapper logger | `specification.md` Part B Implementation Notes; `agents.md` §6.2; `.cursor/rules/security-compliance.mdc` |
| **Webhook signature verification on the raw body** + 5-min tolerance + inbox dedup | `specification.md` Tasks A6, B6; `.cursor/rules/events.mdc` |
| **mTLS for service-to-service**; HTTP-only `Secure` `SameSite=Strict` cookies for users | `specification.md` Task C8; `agents.md` §6.3 |
| **Defense-in-depth rate limiting** (per-user + per-IP + per-action class) with fail-closed for sensitive routes | `specification.md` Task B7 |
| **Security headers + CORS allow-list** (HSTS preload, CSP, COOP, CORP, Permissions-Policy) | `specification.md` Task C7 |
| **KMS customer-managed keys referenced by alias** (annual rotation, no version pinning) | `specification.md` Task B5; `.cursor/rules/infra.mdc` |
| **Secret rotation with grace window** (24 h dual-secret acceptance during rotation) | `specification.md` Task B6; `.cursor/rules/infra.mdc` |
| **RBAC permission matrix** as code with CI-enforced PR label and matrix-completeness test | `specification.md` Tasks B8, D8; `agents.md` §6.3 |
| **Existence-leak avoidance** (`404` not `403` for cross-user reads) | `specification.md` Tasks A5, A7; `.cursor/rules/api.mdc` |

### Audit & observability

| Practice | Where it appears |
|---|---|
| **Tamper-evident, hash-chained audit log** with daily watermarks to S3 Object Lock | `specification.md` Task B2; `agents.md` §4.6 |
| **Differentiated retention** — 7y financial / 5y access — backed by S3 Object Lock retention modes | `specification.md` Task B2; `.cursor/rules/infra.mdc` |
| **OpenTelemetry tracing + structured JSON logs + Prometheus metrics**; `X-Correlation-Id` propagated through HTTP, Kafka, audit | `specification.md` Tasks A15, C6 |
| **SLO-based reliability with multi-window burn-rate alerts** (2%/1h fast burn, 10%/3d slow burn) | `specification.md` Task B9 |
| **Runbook catalog co-versioned with the system** (Stripe outage, Kafka outage, PAN exposure, etc.) | `specification.md` Task B9 |
| **Quarterly disaster-recovery drills** with RPO ≤ 5 min, RTO ≤ 60 min | `specification.md` Task B10 |

### Data, money, and concurrency

| Practice | Where it appears |
|---|---|
| **Money as integer `BIGINT` minor units** with explicit currency — no floats anywhere | `specification.md` Part B Implementation Notes; `agents.md` §4.1; `.cursor/rules/database.mdc` |
| **ULIDs with entity-prefixed branded types** instead of `SERIAL` / `UUID v4` | `specification.md` Part A Implementation Notes; `.cursor/rules/database.mdc`; `.cursor/rules/backend.mdc` |
| **Optimistic locking** on every aggregate (`version INT`); conflicts surface `409` (never silent retry) | `specification.md` Task A1; `agents.md` §4.4; `.cursor/rules/database.mdc` |
| **Strict FSM for card lifecycle** with table-driven legal transitions and `409 card.illegal_transition` | `specification.md` Task A1 |
| **`TIMESTAMPTZ` UTC + RFC 3339 with `Z`** at API boundary | `specification.md` Part A Implementation Notes; `.cursor/rules/database.mdc` |

### Eventing & integration

| Practice | Where it appears |
|---|---|
| **Transactional outbox** — event rows committed in the same DB transaction as state changes | `specification.md` Task A13; `agents.md` §8; `.cursor/rules/events.mdc` |
| **Versioned Avro schemas** with topic naming `lumen.<context>.<entity>.<event>.v<n>` | `specification.md` Task A13; `.cursor/rules/events.mdc` |
| **Idempotent consumers** with inbox dedup by `eventId` — at-least-once accepted | `specification.md` Tasks A6, A13, B6 |
| **Saga pattern with compensating actions** for cross-service workflows (issuance, replacement) | `specification.md` Tasks A2, A9 |
| **Out-of-order event tolerance** (project deterministically, reconcile on later event) | `specification.md` Task A6 |

### API design

| Practice | Where it appears |
|---|---|
| **OpenAPI 3.1 as single source of truth** + contract-drift gate in CI | `specification.md` Task C3; `.cursor/rules/api.mdc` |
| **Canonical error envelope** with a stable error-code catalog and a `correlationId` on every error | `specification.md` Task C2; `.cursor/rules/api.mdc` |
| **Mandatory `Idempotency-Key`** on every non-GET route, 24 h persisted cache | `specification.md` Task C5; `agents.md` §8; `.cursor/rules/api.mdc` |
| **Cursor-based pagination** with whitelisted sort fields | `specification.md` Task C4; `.cursor/rules/api.mdc` |
| **Deprecation / sunset policy** with `Deprecation` and `Sunset` headers and 90-day overlap | `specification.md` Task C1 |
| **Generated typed SDK from OpenAPI** + a Prism mock server for offline frontend dev | `specification.md` Tasks C9, C10 |
| **Partner-API specified but feature-flagged off** (signed webhooks + scoped API keys) for future B2B enablement | `specification.md` Task C11 |
| **ETags / conditional GET only on non-sensitive read endpoints** | `specification.md` Task C12 |

### Testing & verification

| Practice | Where it appears |
|---|---|
| **Property-based testing** (`fast-check`) for FSM, pagination, idempotency, money | `specification.md` Task D5; `.cursor/rules/testing.mdc` |
| **Testcontainers** for hermetic integration tests (Postgres, Redis, Kafka) | `specification.md` Task D2; `.cursor/rules/testing.mdc` |
| **Recorded Stripe-sandbox fixtures** (PAN-scrubbed at record time) replayed in CI | `specification.md` Task D3 |
| **Contract tests** validating OpenAPI ↔ controllers ↔ SDK ↔ mock server | `specification.md` Task D4 |
| **Compliance tests producing machine-readable evidence** (audit-chain verify, GDPR erasure proof, retention) | `specification.md` Task D9 |
| **Chaos / fault-injection nightly** with declarative scenarios | `specification.md` Task D10 |
| **Layered coverage thresholds** (domain ≥ 85/90, libs ≥ 90/95, BFFs ≥ 70/75) | `specification.md` Part B Implementation Notes, Task D1; `.cursor/rules/testing.mdc` |
| **Deterministic time / RNG / ULIDs** in tests via injected shims | `specification.md` Task D1; `.cursor/rules/testing.mdc` |
| **Mutation testing as an advisory trend** (Stryker, nightly) | `specification.md` Task D11 |

### Engineering hygiene

| Practice | Where it appears |
|---|---|
| **Conventional Commits + PR titles citing Task IDs** | `agents.md` §5 |
| **Definition-of-Done checklist** (~18 items) self-checked by the agent before review | `agents.md` §11 |
| **Clarification protocol** with required question format ("Option A vs B, recommendation Z because …") | `agents.md` §12 |
| **Forbidden behaviors** list (PAN logging, raw `UPDATE`, `console.*`, floats for money, etc.) | `agents.md` §13; mirrored as `Forbidden` sections in every `.mdc` rule |
| **One-concern Cursor rules** with scoped globs, two `alwaysApply: true` files only (general + security/compliance) | `.cursor/rules/*.mdc` |
| **Rule precedence declared explicitly** so conflicts resolve deterministically | `.cursor/rules/general.mdc` |

---

## Assumptions & out-of-scope (so the boundary is explicit)

- **KYC and AML** are upstream / sibling systems. Lumen Cards consumes a `kycStatus = VERIFIED` precondition and emits events; it does not implement KYC or AML monitoring.
- **Core ledger / treasury / settlement** is a separate system. Lumen Cards calls it but does not own it.
- **Physical cards, rewards, statements, tax docs** are out of scope.
- **Multi-currency** is out of scope (MVP is EUR-only); non-EUR auths are rejected at the processor edge.
- **Partner / B2B API** is specified (Task C11) but feature-flagged off in MVP.
- **Tech stack assumptions** (Node 20 + NestJS 10 + PostgreSQL 16 + Redis + Kafka + Stripe Issuing + AWS EU regions) are clarifying decisions the spec makes so an AI partner has unambiguous context; the spec's tasks are otherwise portable.
- **Performance numbers** are labelled assumed targets, calibrated as described in [How I chose performance targets](#how-i-chose-performance-targets).
- **Compliance documents** (`docs/pci-scope.md`, `docs/ropa.md`, `docs/outsourcing-register.md`, `docs/key-inventory.md`, etc.) are referenced as deliverables alongside code changes; the spec describes their contracts and update-cadence, not their full contents.

---

## Acknowledgements & references

- Assignment definition: [`TASKS.md`](./TASKS.md)
- Cursor rule-authoring guidance followed for `.cursor/rules/*.mdc` structure (frontmatter, globs, conciseness, examples)
- External reference frames informally drawn on: Stripe Issuing documentation (processor model, ephemeral keys, webhook signing), Google SRE Workbook (SLOs, burn-rate alerting), Martin Fowler's transactional outbox pattern, OWASP ASVS (security headers, session handling), EBA Guidelines on outsourcing arrangements (EBA/GL/2019/02), Nielsen Norman Group (UX latency thresholds).
