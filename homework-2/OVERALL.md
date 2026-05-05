# Implementation Guide — Best Practices & Developer Notes

This document captures implementation details, cross-cutting best practices, and decision rationale that do not belong in the API Reference, Architecture, or Testing guides. It is aimed at developers building or extending this system.

---

## Table of Contents

1. [Recommended Implementation Order](#1-recommended-implementation-order)
2. [Environment Configuration](#2-environment-configuration)
3. [TypeScript & Project Setup](#3-typescript--project-setup)
4. [Express App Wiring](#4-express-app-wiring)
5. [Zod Schema Design](#5-zod-schema-design)
6. [Error Hierarchy](#6-error-hierarchy)
7. [Async Error Handling](#7-async-error-handling)
8. [Logging Discipline](#8-logging-discipline)
9. [Multer File Upload Hardening](#9-multer-file-upload-hardening)
10. [CSV Edge Cases](#10-csv-edge-cases)
11. [XML Security Hardening](#11-xml-security-hardening)
12. [Classification Engine Details](#12-classification-engine-details)
13. [Prisma Repository Pattern](#13-prisma-repository-pattern)
14. [Graceful Shutdown](#14-graceful-shutdown)
15. [Security Middleware Stack](#15-security-middleware-stack)
16. [Pagination Utility](#16-pagination-utility)
17. [Idempotent Imports (Bonus)](#17-idempotent-imports-bonus)
18. [Common Pitfalls](#18-common-pitfalls)

---

## 1. Recommended Implementation Order

Follow this sequence so each step is independently verifiable before building the next:

1. **Project scaffold** — `package.json`, `tsconfig.json`, ESLint + Prettier config, Husky + lint-staged pre-commit hook.
2. **App skeleton** — `app.ts` (Express factory) + `server.ts` (port binding) + `/health` endpoint. Verify with `curl /health`.
3. **Config & logging** — `config/env.ts` (Zod-validated env), `config/logger.ts` (Pino). App refuses to start with missing env vars.
4. **Domain schema** — `domain/ticket.schema.ts` (Zod), `domain/ticket.types.ts` (enums), `domain/errors.ts`. Write `ticket.model.test.ts` first (TDD).
5. **Repository + DB** — `prisma/schema.prisma`, first migration, `repositories/tickets.repository.ts`.
6. **CRUD service + endpoints** — `services/tickets.service.ts`, `controllers/tickets.controller.ts`, `routes/tickets.routes.ts`. Run `tickets.api.test.ts` to verify.
7. **Importers** — Pure parser modules (unit-tested), then `services/import.service.ts`, then the `/tickets/import` route with multer.
8. **Classification engine** — `classification/rules.ts` (data), `categorizer.ts`, `prioritizer.ts` (pure functions, unit-tested), then `services/classification.service.ts` and the `/auto-classify` endpoint.
9. **Integration & performance tests** — `workflow.test.ts`, `benchmarks.test.ts`. Push coverage above 85%.
10. **OpenAPI + Swagger UI** — Wire `@asteasolutions/zod-to-openapi` to generate the spec; serve at `/docs`.
11. **Documentation** — Finalize `README.md`, `API_REFERENCE.md`, `ARCHITECTURE.md`, `TESTING_GUIDE.md`, `HOWTORUN.md`.
12. **Fixtures & screenshots** — Generate sample data files; capture coverage screenshot for `docs/screenshots/`.

---

## 2. Environment Configuration

Always validate environment variables at startup with a Zod schema. Never scatter `process.env.FOO` calls through the codebase.

```ts
// src/config/env.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(10),
  AUTO_CLASSIFY_DEFAULT: z.coerce.boolean().default(false),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

`.env.example`:
```
NODE_ENV=development
PORT=3000
DATABASE_URL="file:./dev.db"
LOG_LEVEL=info
RATE_LIMIT_MAX=100
MAX_UPLOAD_SIZE_MB=10
AUTO_CLASSIFY_DEFAULT=false
```

---

## 3. TypeScript & Project Setup

Recommended `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Key `package.json` scripts:
```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "lint": "eslint src tests --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:cov": "vitest run --coverage",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:perf": "vitest bench tests/performance",
    "test:watch": "vitest",
    "fixtures:generate": "tsx scripts/generate-fixtures.ts",
    "prisma:migrate": "prisma migrate dev"
  }
}
```

---

## 4. Express App Wiring

The key pattern is separating `app.ts` (factory) from `server.ts` (listener):

```ts
// src/app.ts
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { logger } from './config/logger.js';
import { env } from './config/env.js';
import { ticketRoutes } from './api/routes/tickets.routes.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { notFound } from './api/middleware/notFound.js';

export function createApp() {
  const app = express();

  // Security middleware — order matters
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN ?? false }));
  if (env.NODE_ENV !== 'test') {
    app.use(rateLimit({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX }));
  }
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  // Routes
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.use('/tickets', ticketRoutes);

  // 404 and error handlers — always last
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

// src/server.ts
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Server started');
});

// Graceful shutdown (see section 14)
process.on('SIGTERM', () => { /* ... */ });
```

---

## 5. Zod Schema Design

Keep all schemas in `domain/ticket.schema.ts`. Export both the schema and its inferred type.

```ts
import { z } from 'zod';
import { Category, Priority, Status, Source, DeviceType } from './ticket.types.js';

export const TicketMetadataSchema = z.object({
  source: z.nativeEnum(Source).optional(),
  browser: z.string().optional().nullable(),
  device_type: z.nativeEnum(DeviceType).optional().nullable(),
});

export const TicketCreateSchema = z.object({
  customer_id: z.string().min(1),
  customer_email: z.string().email(),
  customer_name: z.string().min(1),
  subject: z.string().min(1).max(200),
  description: z.string().min(10).max(2000),
  category: z.nativeEnum(Category).default(Category.OTHER),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  status: z.nativeEnum(Status).default(Status.NEW),
  assigned_to: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  metadata: TicketMetadataSchema.optional(),
});

export type TicketCreate = z.infer<typeof TicketCreateSchema>;

export const TicketQuerySchema = z.object({
  category: z.nativeEnum(Category).optional(),
  priority: z.nativeEnum(Priority).optional(),
  status: z.nativeEnum(Status).optional(),
  assigned_to: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
```

The `validate` middleware calls `schema.safeParse(req.body)` and forwards the result or short-circuits with a `ValidationError`. This keeps controllers clean:

```ts
// src/api/middleware/validate.ts
import { ZodSchema } from 'zod';
import { ValidationError } from '../../domain/errors.js';
import { RequestHandler } from 'express';

export const validate =
  (schema: ZodSchema, target: 'body' | 'query' | 'params' = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(new ValidationError(result.error.flatten().fieldErrors));
    }
    req[target] = result.data;
    next();
  };
```

---

## 6. Error Hierarchy

```ts
// src/domain/errors.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('VALIDATION_ERROR', 'Request body is invalid', 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} ${id} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class UnsupportedMediaError extends AppError {
  constructor(received: string, accepted: string[]) {
    super(
      'UNSUPPORTED_MEDIA_TYPE',
      `Unsupported file type: ${received}. Accepted: ${accepted.join(', ')}`,
      415,
    );
  }
}

export class ImportParseError extends AppError {
  constructor(message: string) {
    super('IMPORT_PARSE_ERROR', message, 400);
  }
}

export class ClassificationOverriddenError extends AppError {
  constructor() {
    super(
      'CLASSIFICATION_OVERRIDDEN',
      'Ticket has been manually classified. Pass ?force=true to override.',
      409,
    );
  }
}
```

The central error handler maps these to HTTP responses and logs unexpected errors:

```ts
// src/api/middleware/errorHandler.ts
import { ErrorRequestHandler } from 'express';
import { AppError } from '../../domain/errors.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
};
```

---

## 7. Async Error Handling

Wrap every async route handler with `asyncHandler` to avoid try/catch boilerplate and ensure unhandled promise rejections are forwarded to the error middleware:

```ts
// src/utils/asyncHandler.ts
import { RequestHandler, Request, Response, NextFunction } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
```

Usage in controllers:
```ts
router.post('/', validate(TicketCreateSchema), asyncHandler(async (req, res) => {
  const ticket = await ticketsService.create(req.body);
  res.status(201).json({ data: ticket });
}));
```

---

## 8. Logging Discipline

Rules:
- Use **structured fields**, not string interpolation. `logger.info({ ticketId }, 'created')` not `logger.info('created ticket ' + id)`.
- Log **business events** at `info` level: ticket created, classified, imported.
- Log **unexpected errors** at `error` level with the full `err` object.
- Log **classification decisions** with `before` and `after` for auditability.
- **Never log PII directly**. Mask `customer_email` in Pino serializers:

```ts
// src/config/logger.ts
import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      id: req.id,
    }),
  },
  redact: ['*.customer_email', '*.email'],
});
```

---

## 9. Multer File Upload Hardening

```ts
// src/api/middleware/upload.ts
import multer from 'multer';
import { env } from '../../config/env.js';
import { UnsupportedMediaError } from '../../domain/errors.js';

const ACCEPTED_MIMES = new Set([
  'text/csv',
  'application/csv',
  'application/json',
  'application/xml',
  'text/xml',
]);

const ACCEPTED_EXTENSIONS = new Set(['.csv', '.json', '.xml']);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ACCEPTED_MIMES.has(file.mimetype) || !ACCEPTED_EXTENSIONS.has(ext)) {
      return cb(new UnsupportedMediaError(file.mimetype, [...ACCEPTED_MIMES]));
    }
    cb(null, true);
  },
});
```

Both MIME type and file extension are checked — a defense-in-depth measure because MIME types can be spoofed by clients.

---

## 10. CSV Edge Cases

Configure `csv-parse` to handle real-world CSV quirks:

```ts
import { parse } from 'csv-parse';

export async function* parseCsv(buffer: Buffer): AsyncIterable<Record<string, string>> {
  yield* buffer.pipe(
    parse({
      bom: true,               // strip UTF-8 BOM
      columns: true,           // use header row as keys
      trim: true,              // strip leading/trailing whitespace from values
      skip_empty_lines: true,
      relax_column_count: false, // fail on rows with wrong number of columns
      cast: false,             // keep everything as string; Zod does type coercion
    }),
  );
}
```

Handle the pipe-separated `tags` column in the importer — not in the schema:
```ts
const rawTags = row.tags ?? '';
const tags = rawTags ? rawTags.split('|').map((t: string) => t.trim()) : [];
```

---

## 11. XML Security Hardening

Configure `fast-xml-parser` to block entity attacks:

```ts
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,   // block XXE / Billion Laughs attacks
  allowBooleanAttributes: true,
});
```

Always wrap the parse call in a try/catch and re-throw as `ImportParseError`:
```ts
try {
  const result = parser.parse(buffer.toString('utf-8'));
  // ...
} catch (err) {
  throw new ImportParseError(`XML parse error: ${(err as Error).message}`);
}
```

---

## 12. Classification Engine Details

### Rules data structure

```ts
// src/classification/rules.ts
export type KeywordRule = { pattern: RegExp; weight: number };

export const CATEGORY_RULES: Record<string, KeywordRule[]> = {
  account_access: [
    { pattern: /\bcan'?t\s+access\b/i, weight: 3 },
    { pattern: /\blogin\b/i,            weight: 2 },
    { pattern: /\bpassword\b/i,         weight: 2 },
    { pattern: /\b2fa\b/i,              weight: 2 },
    { pattern: /\bsign[\s-]?in\b/i,     weight: 1 },
  ],
  billing_question: [
    { pattern: /\bpayment\b/i,  weight: 3 },
    { pattern: /\binvoice\b/i,  weight: 3 },
    { pattern: /\brefund\b/i,   weight: 3 },
    { pattern: /\bbilling\b/i,  weight: 2 },
    { pattern: /\bcharge\b/i,   weight: 1 },
  ],
  // ... other categories
};

export const PRIORITY_RULES: Record<string, KeywordRule[]> = {
  urgent: [
    { pattern: /\bcan'?t\s+access\b/i,    weight: 3 },
    { pattern: /\bcritical\b/i,           weight: 3 },
    { pattern: /\bproduction\s+down\b/i,  weight: 3 },
    { pattern: /\bsecurity\b/i,           weight: 2 },
  ],
  high: [
    { pattern: /\bimportant\b/i, weight: 2 },
    { pattern: /\bblocking\b/i,  weight: 2 },
    { pattern: /\basap\b/i,      weight: 2 },
  ],
  low: [
    { pattern: /\bminor\b/i,      weight: 2 },
    { pattern: /\bcosmetic\b/i,   weight: 2 },
    { pattern: /\bsuggestion\b/i, weight: 1 },
  ],
};
```

### Confidence calculation

```
totalWeight = sum of weights for all matched patterns in a category
threshold   = sum of all weights in that category's rule list
confidence  = min(1.0, totalWeight / threshold)
```

If the top-2 scoring categories differ by less than 15%, return `other` with `confidence = 0.3`. This prevents false certainty on ambiguous tickets.

### Decision logging

```ts
logger.info({
  ticketId,
  input: { category: before.category, priority: before.priority },
  output: { category: result.category, priority: result.priority },
  confidence: result.confidence,
  keywords: result.keywords,
}, 'auto-classify');
```

---

## 13. Prisma Repository Pattern

The repository is the only module that imports `PrismaClient`. Services depend on the repository interface, not Prisma directly. For tests, pass a mocked repository to the service constructor.

```ts
// src/repositories/tickets.repository.ts
import { PrismaClient } from '@prisma/client';
import { TicketCreate, TicketQuery } from '../domain/ticket.schema.js';

const prisma = new PrismaClient();  // singleton

export class TicketsRepository {
  async create(data: TicketCreate) {
    return prisma.ticket.create({ data: { id: crypto.randomUUID(), ...data } });
  }

  async findById(id: string) {
    return prisma.ticket.findUnique({ where: { id } });
  }

  async findMany(query: TicketQuery) {
    const { category, priority, status, assigned_to, q, page, pageSize, sort, order } = query;
    const where = {
      ...(category && { category }),
      ...(priority && { priority }),
      ...(status && { status }),
      ...(assigned_to && { assigned_to }),
      ...(q && {
        OR: [
          { subject: { contains: q } },
          { description: { contains: q } },
        ],
      }),
    };
    const [data, total] = await prisma.$transaction([
      prisma.ticket.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.ticket.count({ where }),
    ]);
    return { data, total };
  }

  async createMany(records: TicketCreate[]) {
    return prisma.ticket.createMany({
      data: records.map((r) => ({ id: crypto.randomUUID(), ...r })),
      skipDuplicates: true,
    });
  }

  async update(id: string, data: Partial<TicketCreate>) {
    return prisma.ticket.update({ where: { id }, data });
  }

  async delete(id: string) {
    return prisma.ticket.delete({ where: { id } });
  }
}
```

---

## 14. Graceful Shutdown

```ts
// src/server.ts (addition)
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received');
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Server closed');
    process.exit(0);
  });

  // Force exit if server hasn't closed after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## 15. Security Middleware Stack

Order is critical. Mount middleware in this exact sequence in `app.ts`:

```
1. helmet()              — secure HTTP headers
2. cors()                — explicit origin allowlist
3. rateLimit()           — per-IP rate limiting (skip in test env)
4. pinoHttp()            — request logging with request IDs
5. express.json()        — JSON body parser with size limit
6. routes                — business routes
7. notFound()            — 404 handler
8. errorHandler()        — centralized error → HTTP response
```

Never put the error handler before the routes or 404 handler.

---

## 16. Pagination Utility

```ts
// src/utils/pagination.ts
export function buildPaginationMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
```

Controllers use this to build consistent response envelopes:
```ts
const { data, total } = await ticketsService.list(query);
res.json({ data, pagination: buildPaginationMeta(query.page, query.pageSize, total) });
```

---

## 17. Idempotent Imports (Bonus)

To prevent duplicate data from retried uploads, accept an optional `Idempotency-Key` header. Hash the file content on the server and cache the result (in-memory Map, Redis, or a DB table) keyed by the idempotency key. On retry, return the cached summary without re-processing.

```
POST /tickets/import
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

This is a bonus feature — implement it only after all required functionality is complete.

---

## 18. Common Pitfalls

| Pitfall | Correct approach |
|---|---|
| Leaking Prisma types to controllers | Always map Prisma records to plain DTO objects in the repository or service |
| Auto-classifying inside the route handler | Put auto-classify logic in the service so it is shared by `create`, `bulkImport`, and the explicit endpoint |
| Client-supplied UUIDs | Always generate IDs server-side with `crypto.randomUUID()` |
| Trusting MIME type alone for file uploads | Cross-check MIME type and file extension in the multer `fileFilter` |
| Using `parseInt` / `parseFloat` on query params | Use `z.coerce.number()` in the Zod query schema — it handles the coercion safely |
| Calling `res.send()` after calling `next()` | Exactly one of these per request — use `return next(err)` to avoid double-send errors |
| Testing with a real port | Use Supertest with `createApp()` directly; it drives the app without binding a port |
| Setting `resolved_at` from the client | Set it server-side in the service when `status` transitions to `resolved` or `closed` |
| `csv-parse` loading entire file | Use `buffer.pipe(parse(...))` to stream; never `parseAsync(buffer, { ... })` on large files |
| Percent-encoding in query strings | Zod coerces strings automatically; do not manually decode `req.query` values |
