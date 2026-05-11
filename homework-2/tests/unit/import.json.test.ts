import { describe, it, expect } from 'vitest';
import { parseJson } from '../../src/importers/json.importer.js';
import { ImportParseError } from '../../src/domain/errors.js';

describe('JSON Importer', () => {
  it('should parse valid JSON array', async () => {
    const json = Buffer.from(
      JSON.stringify([
        {
          customer_id: 'cust_001',
          customer_email: 'user@example.com',
          customer_name: 'John',
          subject: 'Test',
          description: 'This is a test description',
        },
      ]),
    );

    const rows: unknown[] = [];
    for await (const row of parseJson(json)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_id: 'cust_001' });
  });

  it('should throw on JSON object instead of array', async () => {
    const json = Buffer.from(
      JSON.stringify({
        customer_id: 'cust_001',
        customer_email: 'user@example.com',
        customer_name: 'John',
        subject: 'Test',
        description: 'This is a test description',
      }),
    );

    try {
      for await (const _row of parseJson(json)) {
        // iterate until error
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ImportParseError);
      if (err instanceof ImportParseError) {
        expect(err.code).toBe('IMPORT_PARSE_ERROR');
      }
    }
  });

  it('should throw on invalid JSON', async () => {
    const json = Buffer.from('{invalid json}');

    try {
      for await (const _row of parseJson(json)) {
        // iterate until error
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ImportParseError);
      if (err instanceof ImportParseError) {
        expect(err.code).toBe('IMPORT_PARSE_ERROR');
      }
    }
  });

  it('should handle empty array', async () => {
    const json = Buffer.from(JSON.stringify([]));

    const rows = [];
    for await (const row of parseJson(json)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(0);
  });
});
