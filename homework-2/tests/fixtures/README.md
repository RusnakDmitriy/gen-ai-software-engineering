# Sample Data & Test Fixtures

This directory contains sample data files and invalid test files for the Customer Support Ticket Management System.

## Valid Sample Data Files

### `sample_tickets.csv` (50 tickets)
- **Format**: Comma-separated values with header row
- **Records**: 50 customer support tickets
- **Fields**: customer_id, customer_email, customer_name, subject, description, category, priority, status, tags, source, browser, device_type
- **Size**: ~12 KB
- **Use**: Import testing with CSV format, bulk data operations

### `sample_tickets.json` (20 tickets)
- **Format**: JSON array of objects
- **Records**: 20 customer support tickets
- **Fields**: customer_id, customer_email, customer_name, subject, description, category, priority, status, tags, source, browser, device_type
- **Size**: ~12 KB
- **Use**: Import testing with JSON format, API integration testing

### `sample_tickets.xml` (30 tickets)
- **Format**: XML with root `<tickets>` element containing `<ticket>` elements
- **Records**: 30 customer support tickets
- **Fields**: customer_id, customer_email, customer_name, subject, description, category, priority, status, tags, and nested metadata (source, browser, device_type)
- **Size**: ~20 KB
- **Use**: Import testing with XML format, data format compatibility testing

## Invalid/Error Test Files

Located in `invalid/` subdirectory for testing error handling and validation:

### `missing_columns.csv`
- **Issue**: CSV with missing required columns (subject in some rows)
- **Expected**: Validation errors during import

### `bad_email.csv`
- **Issue**: CSV with invalid email addresses that fail validation
- **Expected**: Import errors on email format validation

### `unterminated.json`
- **Issue**: Malformed JSON with unterminated array
- **Expected**: JSON parse error

### `wrong_enums.json`
- **Issue**: JSON with invalid enum values for category and priority
- **Expected**: Validation errors on enum type checking

### `no_root.xml`
- **Issue**: XML missing required root `<tickets>` element
- **Expected**: XML structure validation error

## Import Testing Quick Start

### Test CSV Import (50 tickets with auto-classification)
```bash
curl -X POST 'http://localhost:3000/tickets/import?auto_classify=true' \
  -F "file=@tests/fixtures/sample_tickets.csv;type=text/csv"
```

### Test JSON Import (20 tickets)
```bash
curl -X POST 'http://localhost:3000/tickets/import?auto_classify=true' \
  -F "file=@tests/fixtures/sample_tickets.json;type=application/json"
```

### Test XML Import (30 tickets)
```bash
curl -X POST 'http://localhost:3000/tickets/import?auto_classify=true' \
  -F "file=@tests/fixtures/sample_tickets.xml;type=application/xml"
```

### Test Error Handling (invalid JSON)
```bash
curl -X POST 'http://localhost:3000/tickets/import?auto_classify=false' \
  -F "file=@tests/fixtures/invalid/unterminated.json;type=application/json"
```

## Data Coverage

The sample files collectively cover:
- **100 valid tickets** across 3 different formats
- **Categories**: account_access, billing_question, technical_issue, bug_report, feature_request, other
- **Priorities**: urgent, high, medium, low
- **Statuses**: new, in_progress, resolved
- **Sources**: web_form, api
- **Devices**: desktop, mobile, tablet
- **Browsers**: Chrome, Firefox, Safari, Edge

## Fixture Statistics

| File | Format | Records | Duplicate | Total |
|------|--------|---------|-----------|-------|
| sample_tickets.csv | CSV | 50 | No | 50 |
| sample_tickets.json | JSON | 20 | No | 20 |
| sample_tickets.xml | XML | 30 | No | 30 |
| **Total Valid** | Mixed | - | - | **100** |
| invalid/*.csv | CSV | 5 | Error cases | 5 |
| invalid/*.json | JSON | 2 | Error cases | 2 |
| invalid/*.xml | XML | 1 | Error cases | 1 |
| **Total Invalid** | Mixed | - | - | **8** |

## Notes

- All sample data contains realistic customer support scenarios
- Tags use pipe-separated (`|`) format for multiple values
- Empty optional fields (browser, device_type) are included for realistic testing
- Invalid files are designed for specific error cases to test validation and error handling
- Files conform to the API schema defined in `API_REFERENCE.md`
