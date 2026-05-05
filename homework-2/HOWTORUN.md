# How to Run — Customer Support Ticket System

## Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **npm** 8+ (comes with Node.js)

Verify installation:

```bash
node --version   # v18.0.0 or higher
npm --version    # 8.0.0 or higher
```

---

## Installation & Setup

### 1. Install Dependencies

```bash
npm install
```

This installs all packages listed in `package.json`:
- Express, TypeScript, Prisma
- Testing: Vitest, Supertest
- Utilities: Zod, Helmet, csv-parse, fast-xml-parser

### 2. Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env
```

The `.env` file now contains:
```
NODE_ENV=development
PORT=3000
DATABASE_URL="file:./dev.db"
LOG_LEVEL=info
RATE_LIMIT_MAX=100
MAX_UPLOAD_SIZE_MB=10
AUTO_CLASSIFY_DEFAULT=false
CORS_ORIGIN=*
```

**No changes needed** — defaults work for development.

### 3. Initialize Database

```bash
# Create SQLite database and run migrations
npx prisma migrate dev --name init
```

This:
- Creates `dev.db` in the `prisma` folder of the project root
- Runs the initial migration to create the `Ticket` table
- Generates Prisma client types

---

## Running the Application

### Development Mode (Hot Reload)

```bash
npm run dev
```

The server starts at **http://localhost:3000**

Output:
```
Server started
{ port: 3000 }
```

The server automatically restarts when you save `.ts` files.

### Production Build

```bash
# Compile TypeScript → JavaScript
npm run build

# Run the compiled version
npm start
```

The compiled code is in the `dist/` folder.

---

## Testing

### Run All Tests

```bash
npm run test
```

Expected output:
```
Test Files  5 passed (5)
Tests      37 passed (37)
```

### Run Tests with Coverage

```bash
npm run test:cov
```

Generates a coverage report in `coverage/index.html`:
```bash
# View the report (macOS)
open coverage/index.html

# View the report (Linux)
xdg-open coverage/index.html

# View the report (Windows)
start coverage/index.html
```

### Run Specific Test Suite

```bash
# Only unit tests
npm run test:unit

# Watch mode (re-run on file change)
npm run test:watch
```

---

## API Usage

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{ "status": "ok", "uptime": 1.234 }
```

### Create a Ticket

```bash
curl -X POST http://localhost:3000/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "cust_001",
    "customer_email": "user@example.com",
    "customer_name": "John Doe",
    "subject": "Cannot log in",
    "description": "I have been unable to access my account for 2 days."
  }'
```

Response:
```json
{
  "data": {
    "id": "clp...",
    "customer_id": "cust_001",
    "category": "other",
    "priority": "medium",
    "status": "new",
    "created_at": "2026-05-04T22:00:00.000Z",
    ...
  }
}
```

### Create with Auto-Classification

```bash
curl -X POST 'http://localhost:3000/tickets?auto_classify=true' \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "cust_002",
    "customer_email": "alice@example.com",
    "customer_name": "Alice Smith",
    "subject": "Production is down critical issue",
    "description": "The API server is not responding. Payments cannot be processed."
  }'
```

Result: Automatically classified as `urgent` priority, `technical_issue` category.

### List Tickets

```bash
# All tickets
curl http://localhost:3000/tickets

# Filter by category
curl "http://localhost:3000/tickets?category=billing_question"

# Search
curl "http://localhost:3000/tickets?q=payment"

# Pagination
curl "http://localhost:3000/tickets?page=2&pageSize=10"
```

### Bulk Import

```bash
# Import CSV
curl -X POST http://localhost:3000/tickets/import \
  -F "file=@sample_tickets.csv"

# Import with auto-classification
curl -X POST 'http://localhost:3000/tickets/import?auto_classify=true' \
  -F "file=@sample_tickets.json"
```

---

## Code Quality

### Linting

```bash
# Check for style issues
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Type Checking

```bash
# Check TypeScript errors (no compilation)
npm run typecheck
```

### Code Formatting

```bash
# Auto-format code
npm run format
```

---

## Project Structure

Key directories:

```
src/
├── api/              # Routes, controllers, middleware
├── config/           # Environment, logging
├── domain/           # Data types, validation schemas
├── services/         # Business logic
├── repositories/     # Database access
├── importers/        # CSV/JSON/XML parsers
├── classification/   # Ticket categorization
└── db/               # Prisma setup

tests/
├── unit/             # Pure function tests
└── fixtures/         # Sample data

prisma/
└── schema.prisma     # Database schema
```

---

## Troubleshooting

### Port Already in Use

If you get `EADDRINUSE` error:

```bash
# Change the port
PORT=3001 npm run dev
```

Or kill the process using port 3000:

```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Database Issues

Reset the database:

```bash
# WARNING: This deletes all data
npx prisma migrate reset --force
```

### Tests Failing

Clear cache:

```bash
rm -rf node_modules/.vite
npm run test
```

### Build Errors

```bash
# Clean and rebuild
rm -rf dist/
npm run build
```

---

## Environment Variables

### Development (default `.env`)

```
NODE_ENV=development        # Enable pretty logs, skip rate limiting
PORT=3000                   # Server port
DATABASE_URL=file:./dev.db  # Local SQLite
LOG_LEVEL=info              # Pino log level
RATE_LIMIT_MAX=100          # Requests per window
MAX_UPLOAD_SIZE_MB=10       # File upload limit
CORS_ORIGIN=*               # Allow all origins
```

### Production Example

```
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://user:pass@db.example.com/tickets
LOG_LEVEL=warn
RATE_LIMIT_MAX=50
MAX_UPLOAD_SIZE_MB=5
CORS_ORIGIN=https://app.example.com
```

---

## Database Inspection

View the database schema and data:

```bash
# Open Prisma Studio (interactive GUI)
npx prisma studio
```

Opens at **http://localhost:5555**

---

## Next Steps

After running the app:

1. **Read the docs**: See [API_REFERENCE.md](API_REFERENCE.md) for all endpoints
2. **Explore the architecture**: See [ARCHITECTURE.md](ARCHITECTURE.md)
3. **Run tests**: `npm run test` to see test coverage
4. **Try the API**: Use the curl examples above

---

## Getting Help

- **Linter errors?** Run `npm run lint:fix`
- **Type errors?** Run `npm run typecheck`
- **Tests failing?** Run `npm run test` to see details
- **Database issues?** Check `dev.db` exists and is readable

