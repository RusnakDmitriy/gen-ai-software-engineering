# API Reference — Intelligent Customer Support Ticket System

Base URL: `http://localhost:3000`

All request and response bodies use `application/json` unless noted otherwise.
Timestamps are ISO-8601 strings in UTC.

---

## Table of Contents

1. [Data Models](#1-data-models)
2. [Error Format](#2-error-format)
3. [Endpoints](#3-endpoints)
   - [Health Check](#health-check)
   - [Create Ticket](#create-ticket)
   - [List Tickets](#list-tickets)
   - [Get Ticket](#get-ticket)
   - [Update Ticket](#update-ticket)
   - [Delete Ticket](#delete-ticket)
   - [Bulk Import](#bulk-import)
   - [Auto-Classify](#auto-classify)
4. [Enum Reference](#4-enum-reference)
5. [HTTP Status Code Reference](#5-http-status-code-reference)

---

## 1. Data Models

### Ticket

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "customer_id": "cust_001",
  "customer_email": "alice@example.com",
  "customer_name": "Alice Smith",
  "subject": "Cannot log in to my account",
  "description": "I have been unable to access my account for 2 days. The password reset email never arrives.",
  "category": "account_access",
  "priority": "urgent",
  "status": "new",
  "created_at": "2026-05-03T18:00:00.000Z",
  "updated_at": "2026-05-03T18:00:00.000Z",
  "resolved_at": null,
  "assigned_to": null,
  "tags": ["login", "password-reset"],
  "metadata": {
    "source": "web_form",
    "browser": "Chrome 124",
    "device_type": "desktop"
  },
  "classification_confidence": 0.92,
  "classification_reasoning": "Matched keywords: can't access, login",
  "classification_keywords": ["can't access", "login"],
  "classification_overridden": false
}
```

### TicketCreate (request body)

Required fields are marked with `*`.

| Field | Type | Constraints |
|---|---|---|
| `customer_id` * | string | non-empty |
| `customer_email` * | string | valid email |
| `customer_name` * | string | non-empty |
| `subject` * | string | 1–200 characters |
| `description` * | string | 10–2000 characters |
| `category` | string enum | see [Enum Reference](#4-enum-reference); defaults to `other` |
| `priority` | string enum | see [Enum Reference](#4-enum-reference); defaults to `medium` |
| `status` | string enum | see [Enum Reference](#4-enum-reference); defaults to `new` |
| `assigned_to` | string | nullable |
| `tags` | string[] | defaults to `[]` |
| `metadata.source` | string enum | see [Enum Reference](#4-enum-reference) |
| `metadata.browser` | string | optional |
| `metadata.device_type` | string enum | see [Enum Reference](#4-enum-reference) |

### ImportSummary (bulk import response)

```json
{
  "total": 50,
  "successful": 47,
  "failed": 3,
  "errors": [
    {
      "row": 12,
      "field": "customer_email",
      "message": "Invalid email address"
    },
    {
      "row": 23,
      "field": "subject",
      "message": "String must contain at least 1 character"
    },
    {
      "row": 41,
      "field": "description",
      "message": "String must contain at most 2000 character(s)"
    }
  ]
}
```

### ClassificationResult

```json
{
  "category": "account_access",
  "priority": "urgent",
  "confidence": 0.92,
  "reasoning": "Matched high-weight keywords in both category and priority tables",
  "keywords": ["can't access", "login", "critical"]
}
```

---

## 2. Error Format

All error responses share the same envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body is invalid",
    "details": [
      {
        "field": "customer_email",
        "message": "Invalid email"
      }
    ]
  }
}
```

| Field | Description |
|---|---|
| `code` | Machine-readable error code (uppercase snake_case) |
| `message` | Human-readable summary |
| `details` | Array of per-field issues (only for validation errors) |

---

## 3. Endpoints

---

### Health Check

```
GET /health
```

Returns the service status. No authentication required.

**Response 200**

```json
{ "status": "ok", "uptime": 142.3 }
```

**cURL**

```bash
curl http://localhost:3000/health
```

---

### Create Ticket

```
POST /tickets
```

Creates a single support ticket. Optionally runs auto-classification immediately.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `auto_classify` | boolean | `false` | Run auto-classification after creation |

**Request body** — `application/json`

```json
{
  "customer_id": "cust_001",
  "customer_email": "alice@example.com",
  "customer_name": "Alice Smith",
  "subject": "Cannot log in to my account",
  "description": "I have been unable to access my account for 2 days. The password reset email never arrives.",
  "tags": ["login"],
  "metadata": {
    "source": "web_form",
    "device_type": "desktop"
  }
}
```

**Response 201**

```json
{
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "customer_id": "cust_001",
    "customer_email": "alice@example.com",
    "customer_name": "Alice Smith",
    "subject": "Cannot log in to my account",
    "description": "I have been unable to access my account for 2 days. The password reset email never arrives.",
    "category": "account_access",
    "priority": "urgent",
    "status": "new",
    "created_at": "2026-05-03T18:00:00.000Z",
    "updated_at": "2026-05-03T18:00:00.000Z",
    "resolved_at": null,
    "assigned_to": null,
    "tags": ["login"],
    "metadata": {
      "source": "web_form",
      "browser": null,
      "device_type": "desktop"
    },
    "classification_confidence": 0.92,
    "classification_reasoning": "Matched keywords: can't access, login",
    "classification_keywords": ["can't access", "login"],
    "classification_overridden": false
  }
}
```

**cURL**

```bash
curl -s -X POST http://localhost:3000/tickets?auto_classify=true \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "cust_001",
    "customer_email": "alice@example.com",
    "customer_name": "Alice Smith",
    "subject": "Cannot log in to my account",
    "description": "I have been unable to access my account for 2 days. The password reset email never arrives.",
    "tags": ["login"],
    "metadata": { "source": "web_form", "device_type": "desktop" }
  }'
```

---

### List Tickets

```
GET /tickets
```

Returns a paginated, filterable list of tickets.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `category` | string enum | Filter by category |
| `priority` | string enum | Filter by priority |
| `status` | string enum | Filter by status |
| `assigned_to` | string | Filter by assignee |
| `q` | string | Full-text search on `subject` and `description` |
| `page` | integer ≥ 1 | Page number (default: `1`) |
| `pageSize` | integer 1–100 | Results per page (default: `20`) |
| `sort` | string | Field to sort by (default: `created_at`) |
| `order` | `asc` \| `desc` | Sort direction (default: `desc`) |

**Response 200**

```json
{
  "data": [ /* array of Ticket objects */ ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 142,
    "totalPages": 8
  }
}
```

**cURL**

```bash
# Filter urgent billing tickets, page 2
curl "http://localhost:3000/tickets?category=billing_question&priority=urgent&page=2&pageSize=10"
```

---

### Get Ticket

```
GET /tickets/:id
```

Returns a single ticket by its UUID.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | UUID of the ticket |

**Response 200**

```json
{
  "data": { /* Ticket object */ }
}
```

**Response 404**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Ticket 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found"
  }
}
```

**cURL**

```bash
curl http://localhost:3000/tickets/3fa85f64-5717-4562-b3fc-2c963f66afa6
```

---

### Update Ticket

```
PUT /tickets/:id
```

Partially updates a ticket. Any subset of mutable fields may be sent.
Setting `classification_overridden: true` prevents future auto-classify calls from overwriting `category` and `priority` unless `force=true` is passed.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | UUID of the ticket |

**Request body** — all fields optional

```json
{
  "status": "in_progress",
  "assigned_to": "agent_bob",
  "priority": "high",
  "classification_overridden": true
}
```

**Response 200**

```json
{
  "data": { /* updated Ticket object */ }
}
```

**Transition rules**

- When `status` is set to `resolved` or `closed`, `resolved_at` is automatically set to the current UTC time if not provided.
- `resolved_at` cannot be set to a datetime before `created_at`.

**cURL**

```bash
curl -s -X PUT http://localhost:3000/tickets/3fa85f64-5717-4562-b3fc-2c963f66afa6 \
  -H "Content-Type: application/json" \
  -d '{ "status": "in_progress", "assigned_to": "agent_bob" }'
```

---

### Delete Ticket

```
DELETE /tickets/:id
```

Permanently deletes a ticket.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | UUID of the ticket |

**Response 204** — no body

**Response 404** — ticket not found

**cURL**

```bash
curl -s -X DELETE http://localhost:3000/tickets/3fa85f64-5717-4562-b3fc-2c963f66afa6
```

---

### Bulk Import

```
POST /tickets/import
```

Imports tickets from a CSV, JSON, or XML file. Uses `multipart/form-data`.

**Request** — `Content-Type: multipart/form-data`

| Form field | Required | Description |
|---|---|---|
| `file` | Yes | The data file (.csv, .json, or .xml). Max size: 10 MB. |

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `auto_classify` | boolean | `false` | Run classification on every successfully imported ticket |

**Accepted MIME types**

| Format | MIME type | Extension |
|---|---|---|
| CSV | `text/csv` or `application/csv` | `.csv` |
| JSON | `application/json` | `.json` |
| XML | `application/xml` or `text/xml` | `.xml` |

**CSV format** — first row must be a header row with these column names:

```
customer_id,customer_email,customer_name,subject,description,category,priority,status,tags,source,browser,device_type
```

`tags` should be a pipe-separated list: `login|password-reset`.

**JSON format** — array of ticket objects:

```json
[
  {
    "customer_id": "cust_001",
    "customer_email": "alice@example.com",
    "customer_name": "Alice Smith",
    "subject": "Cannot log in",
    "description": "I have been unable to access my account.",
    "metadata": { "source": "api" }
  }
]
```

**XML format**:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>cust_001</customer_id>
    <customer_email>alice@example.com</customer_email>
    <customer_name>Alice Smith</customer_name>
    <subject>Cannot log in</subject>
    <description>I have been unable to access my account for 2 days.</description>
    <metadata>
      <source>email</source>
      <device_type>mobile</device_type>
    </metadata>
  </ticket>
</tickets>
```

**Response 201**

```json
{
  "data": {
    "total": 50,
    "successful": 47,
    "failed": 3,
    "errors": [
      { "row": 12, "field": "customer_email", "message": "Invalid email address" },
      { "row": 23, "field": "subject", "message": "String must contain at least 1 character" },
      { "row": 41, "field": "description", "message": "String must contain at most 2000 character(s)" }
    ]
  }
}
```

Note: a `201` is returned even for partial failures. Only a completely unparseable file (e.g., corrupt XML) returns a `400`.

**Response 400** — malformed file

```json
{
  "error": {
    "code": "IMPORT_PARSE_ERROR",
    "message": "XML parse error at line 14: Unexpected token"
  }
}
```

**Response 415** — unsupported file type

```json
{
  "error": {
    "code": "UNSUPPORTED_MEDIA_TYPE",
    "message": "Unsupported file type: application/pdf. Accepted: text/csv, application/json, application/xml"
  }
}
```

**cURL**

```bash
# Import CSV
curl -s -X POST "http://localhost:3000/tickets/import?auto_classify=true" \
  -F "file=@tests/fixtures/sample_tickets.csv"

# Import JSON
curl -s -X POST http://localhost:3000/tickets/import \
  -F "file=@tests/fixtures/sample_tickets.json"

# Import XML
curl -s -X POST http://localhost:3000/tickets/import \
  -F "file=@tests/fixtures/sample_tickets.xml"
```

---

### Auto-Classify

```
POST /tickets/:id/auto-classify
```

Runs the rule-based classification engine on the ticket's `subject` and `description` and updates the record.

If `classification_overridden` is `true` on the ticket, this endpoint returns a `409` unless `?force=true` is supplied.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | UUID of the ticket |

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `force` | boolean | `false` | Override the manual override flag and re-classify |

**Response 200**

```json
{
  "data": {
    "category": "account_access",
    "priority": "urgent",
    "confidence": 0.92,
    "reasoning": "Matched high-weight keywords in both category and priority tables",
    "keywords": ["can't access", "login", "critical"]
  }
}
```

**Response 404** — ticket not found

**Response 409** — classification is locked by manual override

```json
{
  "error": {
    "code": "CLASSIFICATION_OVERRIDDEN",
    "message": "Ticket has been manually classified. Pass ?force=true to override."
  }
}
```

**cURL**

```bash
# Normal classify
curl -s -X POST http://localhost:3000/tickets/3fa85f64-5717-4562-b3fc-2c963f66afa6/auto-classify

# Force re-classify even if manually overridden
curl -s -X POST "http://localhost:3000/tickets/3fa85f64-5717-4562-b3fc-2c963f66afa6/auto-classify?force=true"
```

---

## 4. Enum Reference

### `category`

| Value | Description |
|---|---|
| `account_access` | Login, password, 2FA issues |
| `technical_issue` | Bugs, errors, crashes |
| `billing_question` | Payments, invoices, refunds |
| `feature_request` | Enhancements, suggestions |
| `bug_report` | Defects with reproduction steps |
| `other` | Uncategorizable |

### `priority`

| Value | Trigger keywords |
|---|---|
| `urgent` | "can't access", "critical", "production down", "security" |
| `high` | "important", "blocking", "asap" |
| `medium` | *(default — no specific keywords matched)* |
| `low` | "minor", "cosmetic", "suggestion" |

### `status`

| Value | Description |
|---|---|
| `new` | Newly created, unassigned |
| `in_progress` | Being worked on |
| `waiting_customer` | Awaiting customer response |
| `resolved` | Issue resolved; `resolved_at` is set |
| `closed` | Ticket closed; `resolved_at` is set |

### `metadata.source`

`web_form` | `email` | `api` | `chat` | `phone`

### `metadata.device_type`

`desktop` | `mobile` | `tablet`

---

## 5. HTTP Status Code Reference

| Status | Meaning | When used |
|---|---|---|
| `200` | OK | Successful GET, PUT, POST (classify) |
| `201` | Created | Successful POST (create, import) |
| `204` | No Content | Successful DELETE |
| `400` | Bad Request | Validation failure, malformed file |
| `404` | Not Found | Ticket ID does not exist |
| `409` | Conflict | Classification locked by manual override |
| `413` | Payload Too Large | File exceeds 10 MB limit |
| `415` | Unsupported Media Type | File type not accepted |
| `422` | Unprocessable Entity | Semantically invalid (e.g., `resolved_at` before `created_at`) |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Unexpected server error |
