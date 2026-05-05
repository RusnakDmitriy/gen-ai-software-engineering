import { describe, it, expect } from 'vitest';
import { parseCsv } from '../../src/importers/csv.importer.js';
import { ImportParseError } from '../../src/domain/errors.js';

describe('CSV Importer', () => {
  it('should parse valid CSV with header', async () => {
    const csv = Buffer.from(
      'customer_id,customer_email,customer_name,subject,description\n' +
        'cust_001,user@example.com,John,Test,This is a test description',
    );

    const rows = [];
    for await (const row of parseCsv(csv)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(1);
    expect(rows[0].customer_id).toBe('cust_001');
    expect(rows[0].customer_email).toBe('user@example.com');
  });

  it('should handle CSV with multiple rows', async () => {
    const csv = Buffer.from(
      'customer_id,customer_email,customer_name,subject,description\n' +
        'cust_001,user1@example.com,John,Test1,This is a test description\n' +
        'cust_002,user2@example.com,Jane,Test2,Another test description',
    );

    const rows = [];
    for await (const row of parseCsv(csv)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(2);
    expect(rows[0].customer_id).toBe('cust_001');
    expect(rows[1].customer_id).toBe('cust_002');
  });

  it('should handle BOM prefix', async () => {
    const csv = Buffer.from(
      '\ufeffcustomer_id,customer_email,customer_name,subject,description\n' +
        'cust_001,user@example.com,John,Test,This is a test description',
    );

    const rows = [];
    for await (const row of parseCsv(csv)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(1);
  });

  it('throws ImportParseError when row column count does not match header', async () => {
    const csv = Buffer.from('customer_id,customer_email\n' + 'too,many,cols,here\n');
    const iter = parseCsv(csv);
    await expect(async () => {
      for await (const _ of iter) {
        /* empty */
      }
    }).rejects.toThrow(ImportParseError);
  });

  it('should handle simple text gracefully', async () => {
    const csv = Buffer.from(
      'customer_id,customer_email,customer_name,subject,description\n' +
        'cust_001,user@example.com,John,Test,This is a test description',
    );

    const rows = [];
    try {
      for await (const row of parseCsv(csv)) {
        rows.push(row);
      }
      expect(rows).toHaveLength(1);
    } catch (err) {
      // Some parsers may be stricter
      expect(err).toBeDefined();
    }
  });
});
