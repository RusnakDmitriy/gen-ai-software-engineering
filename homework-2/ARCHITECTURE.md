# Architecture — Intelligent Customer Support Ticket System

## Table of Contents

1. [High-Level Context](#1-high-level-context)
2. [Component Overview](#2-component-overview)
3. [Layered Architecture](#3-layered-architecture)
4. [Request Data Flow](#4-request-data-flow)
5. [Bulk Import Flow](#5-bulk-import-flow)
6. [Auto-Classification Flow](#6-auto-classification-flow)
7. [Module Descriptions](#7-module-descriptions)
8. [Data Model](#8-data-model)
9. [Design Decisions & Trade-offs](#9-design-decisions--trade-offs)
10. [Security Considerations](#10-security-considerations)
11. [Performance Considerations](#11-performance-considerations)

---

## 1. High-Level Context

```mermaid
C4Context
    title System Context — Customer Support Ticket System

    Person(user, "API Consumer", "A client app, support agent UI, or integration")
    System(api, "Ticket System", "Node.js/Express REST API for creating, importing, classifying, and managing support tickets")
    SystemDb(db, "SQLite / PostgreSQL", "Persistent ticket store")
    System_Ext(files, "File Uploads", "CSV, JSON, XML ticket batches from external systems")

    Rel(user, api, "HTTPS / REST")
    Rel(files, api, "multipart/form-data upload")
    Rel(api, db, "Prisma ORM")
```

The system is a standalone REST service. All state lives in a relational database managed through **Prisma ORM**, which supports both SQLite (development) and PostgreSQL (production) without code changes.

---

## 2. Component Overview

```mermaid
flowchart TB
    subgraph HTTP["HTTP Layer"]
        R[Express Router]
        MW[Middleware Stack\nhelmet · cors · rate-limit · pino-http · multer]
        V[Zod Validation Middleware]
        C[Controllers]
        EH[Central Error Handler]
    end

    subgraph Domain["Domain / Business Logic"]
        TS[TicketsService]
        IS[ImportService]
        CS[ClassificationService]
        CAT[Categorizer\npure function]
        PRI[Prioritizer\npure function]
        RULES[rules.ts\nkeyword data]
    end

    subgraph Infra["Infrastructure"]
        REPO[TicketsRepository\nPrisma]
        LOG[Pino Logger]
        DB[(SQLite / PostgreSQL)]
    end

    subgraph Parsers["Importers"]
        CSVI[CSV Importer\ncsv-parse stream]
        JSONI[JSON Importer]
        XMLI[XML Importer\nfast-xml-parser]
        DISP[Importer Dispatcher]
    end

    R --> MW --> V --> C
    C --> TS
    C --> IS
    C -. errors .-> EH
    TS --> REPO
    TS --> CS
    IS --> DISP
    IS --> TS
    DISP --> CSVI & JSONI & XMLI
    CS --> CAT & PRI
    CAT & PRI --> RULES
    REPO --> DB
    EH & TS & IS & CS --> LOG
```

---

## 3. Layered Architecture

The system is a **layered monolith** (hexagonal-lite). Each layer has a single responsibility and depends only on the layer below it.

```mermaid
graph TD
    A["Routes & Middleware\n(HTTP contract, no business logic)"]
    B["Controllers\n(translate HTTP ↔ service calls)"]
    C["Services\n(orchestrate use cases, own transactions)"]
    D["Repositories\n(data access, Prisma)"]
    E["Database\n(SQLite / PostgreSQL)"]
    F["Importers\n(pure parsers, no DB access)"]
    G["Classification Engine\n(pure functions, no I/O)"]

    A --> B --> C --> D --> E
    C --> F
    C --> G
```

**Strict rules that are enforced:**

- Controllers never access the database directly; they call services.
- Services never construct HTTP responses; they throw typed errors.
- Importers and classification functions are **pure** — no I/O, no side effects. This makes them trivially unit-testable.
- The repository is the only module allowed to import Prisma.

---

## 4. Request Data Flow

Sequence for a standard `POST /tickets` request:

```mermaid
sequenceDiagram
    participant Client
    participant Middleware
    participant Controller
    participant TicketsService
    participant ClassificationService
    participant Repository
    participant DB

    Client->>Middleware: POST /tickets (JSON body)
    Middleware->>Middleware: helmet, cors, rate-limit, pino-http
    Middleware->>Middleware: Zod validate(TicketCreateSchema)
    Middleware->>Controller: req (typed, validated)
    Controller->>TicketsService: create(dto, { autoClassify })
    alt autoClassify = true
        TicketsService->>ClassificationService: classify(subject + description)
        ClassificationService-->>TicketsService: { category, priority, confidence, keywords }
    end
    TicketsService->>Repository: create(ticketData)
    Repository->>DB: INSERT
    DB-->>Repository: created record
    Repository-->>TicketsService: Ticket
    TicketsService-->>Controller: Ticket
    Controller-->>Client: 201 { data: Ticket }
```

---

## 5. Bulk Import Flow

```mermaid
sequenceDiagram
    participant Client
    participant Multer
    participant Controller
    participant ImportService
    participant Dispatcher
    participant Parser
    participant TicketsService
    participant DB

    Client->>Multer: POST /tickets/import (multipart, file)
    Multer->>Multer: size limit check, MIME check
    Multer->>Controller: req.file (buffer in memory)
    Controller->>ImportService: importFile(buffer, mimeType, filename)
    ImportService->>Dispatcher: resolve(mimeType, extension)
    Dispatcher->>Parser: parse(buffer) → AsyncIterable<RawRow>
    loop each row
        Parser-->>ImportService: RawRow
        ImportService->>ImportService: TicketCreateSchema.safeParse(row)
        alt valid
            ImportService->>ImportService: accumulate valid[]
        else invalid
            ImportService->>ImportService: accumulate errors[{ row, field, message }]
        end
    end
    ImportService->>TicketsService: bulkCreate(valid[])
    TicketsService->>DB: INSERT (batch, single transaction)
    DB-->>TicketsService: created[]
    TicketsService-->>ImportService: created[]
    ImportService-->>Controller: ImportSummary
    Controller-->>Client: 201 { total, successful, failed, errors[] }
```

---

## 6. Auto-Classification Flow

```mermaid
sequenceDiagram
    participant Client
    participant Controller
    participant ClassificationService
    participant Categorizer
    participant Prioritizer
    participant Rules
    participant Repository

    Client->>Controller: POST /tickets/:id/auto-classify
    Controller->>Repository: findById(id)
    Repository-->>Controller: Ticket
    Controller->>ClassificationService: classify(ticket.subject + ticket.description)
    ClassificationService->>ClassificationService: normalize(text)
    ClassificationService->>Categorizer: categorize(normalizedText)
    Categorizer->>Rules: keyword tables
    Rules-->>Categorizer: weighted keyword maps
    Categorizer-->>ClassificationService: { category, confidence, matchedKeywords }
    ClassificationService->>Prioritizer: prioritize(normalizedText)
    Prioritizer->>Rules: priority keyword tables
    Rules-->>Prioritizer: weighted keyword maps
    Prioritizer-->>ClassificationService: { priority, confidence, matchedKeywords }
    ClassificationService-->>Controller: ClassificationResult
    Controller->>Repository: update(id, { category, priority, classificationConfidence, ... })
    Controller-->>Client: 200 { category, priority, confidence, reasoning, keywords }
```

---

## 7. Module Descriptions

### `src/app.ts`
Express application factory. Registers all middleware and routes in a deterministic order. Does **not** call `.listen()` — that is done in `server.ts`. This separation allows Supertest to drive the app in tests without binding a port.

### `src/config/env.ts`
Parses `process.env` through a Zod schema at startup. If any required variable is missing or invalid, the process exits immediately with a descriptive error. This implements the **fail-fast** principle for configuration.

### `src/domain/ticket.schema.ts`
Single source of truth for the Ticket shape. Exports:
- `TicketCreateSchema` — validated input from clients/importers
- `TicketSchema` — full persisted record
- `TicketQuerySchema` — validated query parameters for `GET /tickets`
- TypeScript types inferred via `z.infer<>`

### `src/classification/categorizer.ts` and `prioritizer.ts`
Pure functions. They receive a normalized text string and return a result object. No imports from Express, Prisma, or any I/O module. Category and priority keyword tables are kept in the separate `rules.ts` data file so they can be updated without touching algorithm logic.

**Confidence calculation:**
```
confidence = min(1.0, totalMatchedWeight / categoryThreshold)
```
When the top-2 candidates are within 15% of each other, the function falls back to `other` / `medium` with a low confidence score to prevent false certainty.

### `src/importers/`
Each importer is a module that accepts a `Buffer` and returns an `AsyncIterable<unknown>`. The dispatcher selects the importer by checking both the MIME type and file extension (defense in depth). The streaming approach means CSV files of any size are processed without loading them entirely into memory.

### `src/repositories/tickets.repository.ts`
The only module allowed to use the Prisma client. Exposes typed methods: `create`, `findById`, `findMany` (with filter/pagination/sort), `update`, `delete`, `createMany`. This hides Prisma from the service layer, making it easy to swap the database adapter in tests.

### `src/api/middleware/errorHandler.ts`
Maps the `AppError` hierarchy to HTTP responses:

| Error class | HTTP status |
|---|---|
| `ValidationError` | 400 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `UnprocessableError` | 422 |
| `UnsupportedMediaError` | 415 |
| Unhandled / unknown | 500 |

In production, 500 responses never include a stack trace.

---

## 8. Data Model

```mermaid
erDiagram
    TICKET {
        uuid id PK
        string customer_id
        string customer_email
        string customer_name
        string subject
        string description
        enum category
        enum priority
        enum status
        datetime created_at
        datetime updated_at
        datetime resolved_at
        string assigned_to
        json tags
        enum source
        string browser
        enum device_type
        float classification_confidence
        string classification_reasoning
        json classification_keywords
        boolean classification_overridden
    }
```

All timestamps are stored in UTC and returned in ISO-8601 format. `resolved_at` is `null` until the ticket transitions to `resolved` or `closed` status. The service validates that `resolved_at` cannot precede `created_at`.

---

## 9. Design Decisions & Trade-offs

### Why SQLite for development / PostgreSQL for production?
Prisma makes switching transparent — only the `DATABASE_URL` changes. SQLite eliminates infra setup for local development and CI. The same migration files apply to both engines.

### Why Zod instead of Joi or class-validator?
Zod schemas derive TypeScript types via `z.infer<>`, eliminating the duplication of a separate interface and a runtime schema. Zod also integrates with `@asteasolutions/zod-to-openapi` to generate an OpenAPI 3.1 spec automatically.

### Why a rule-based classifier instead of an ML model?
The spec is explicitly keyword-driven. A rule-based engine is deterministic, fully testable, and has zero inference latency. It requires no model hosting or API key. The confidence scoring makes it honest about uncertainty. Upgrading to an ML-backed classifier later is straightforward — the `ClassificationService` is behind an interface.

### Why streaming CSV parsing?
`csv-parse` with the streaming API processes rows as they arrive from the buffer, never loading the entire file into memory. This keeps memory usage constant at O(batch_size) regardless of file size, which is important for large bulk imports.

### Why `app.ts` separate from `server.ts`?
Supertest can import `app` and make requests without binding a real TCP port. This makes integration tests faster, parallel-safe (no port conflicts), and avoids `EADDRINUSE` errors in CI.

### Why pure functions for classification?
Pure functions are deterministic, side-effect free, and require no mocking. The test for `categorize("can't access my account")` is a single line with no setup. They also compose trivially — the service calls them in sequence without coupling.

---

## 10. Security Considerations

| Concern | Mitigation |
|---|---|
| HTTP hardening | `helmet` sets secure headers on every response |
| CORS | Explicit allowlist in config, not `*` |
| Rate limiting | `express-rate-limit` — 100 req/15 min per IP by default |
| File upload abuse | `multer` limits: `fileSize: 10 MB`, `files: 1`; MIME allowlist; extension cross-check |
| XML injection (XXE / Billion Laughs) | `fast-xml-parser` configured with `processEntities: false` |
| SQL injection | Impossible via Prisma's parameterized queries |
| Stack trace leakage | Error handler strips stack traces in `NODE_ENV=production` |
| PII in logs | `customer_email` masked in Pino serializers |
| Env secret exposure | All secrets are in `.env` (gitignored); Zod validates at boot |
| Large payloads | `express.json({ limit: '1mb' })` on JSON body parser |

---

## 11. Performance Considerations

| Concern | Strategy |
|---|---|
| Bulk insert | Single Prisma `createMany` call per import batch in one transaction |
| CSV streaming | Row-by-row streaming prevents memory spikes |
| DB indexing | Indexes on `category`, `priority`, `status`, `created_at` for common filter queries |
| Classification latency | Pure synchronous regex matching — sub-millisecond per ticket |
| Response payload | Pagination defaults: `pageSize=20`, max `100`; prevents unbounded list responses |
| Logging overhead | Pino is the fastest Node.js logger; async transport in production |
| Cold start | Prisma client singleton instantiated once on module load |
