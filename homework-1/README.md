# Banking Transactions API (NestJS)

**Student Name:** Dmytro Rusnak  
**Date Submitted:** April 25, 2026  
**AI Tools Used:** Cursor

Minimal REST API for banking transactions built with NestJS and TypeScript.

## Implemented Features

- Required endpoints:
  - `POST /transactions`
  - `GET /transactions`
  - `GET /transactions/:id`
  - `GET /accounts/:accountId/balance`
- Required validation:
  - Positive amount with max 2 decimal places
  - Account format validation: `ACC-XXXXX` (alphanumeric)
  - Currency code validation (supported set includes `USD`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD`)
  - Meaningful validation error response:
    - `error: "Validation failed"`
    - `details: [{ field, message }]`
- Required filtering on `GET /transactions`:
  - `accountId`
  - `type`
  - `from` / `to` date range
  - Supports combined filters
- Additional feature implemented (Task 4 Option A):
  - `GET /accounts/:accountId/summary` with:
    - `totalDeposits`
    - `totalWithdrawals`
    - `transactionCount`
    - `mostRecentTransactionDate`

## Architecture Decisions

- In-memory storage is used via `TransactionsService` (no database).
- Controllers are separated by domain:
  - `TransactionsController` for transaction operations
  - `AccountsController` for balance/summary operations
- Request DTOs and pipes enforce input validation before business logic.
- Validation response format is standardized through a custom exception factory.

## Project Structure

- `src/routes` - REST controllers
- `src/models` - transaction model and types
- `src/validators` - DTOs and custom validation pipe
- `src/services` - in-memory business logic
- `src/utils` - reusable helpers
- `demo` - startup and sample request files

## Testing

Unit tests are provided for all functional code areas:

- Service business logic
- Controllers
- DTO validation
- Custom validation pipe
- Utility functions
- Module composition
