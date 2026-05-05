import { describe, it, expect } from 'vitest';
import { validateFileType, parseFile } from '../../src/importers/index.js';
import { UnsupportedMediaError, ImportParseError } from '../../src/domain/errors.js';

describe('importers index', () => {
  it('validateFileType accepts csv with text/csv', () => {
    expect(() => validateFileType('text/csv', 'tickets.csv')).not.toThrow();
  });

  it('validateFileType rejects wrong MIME', () => {
    expect(() => validateFileType('application/pdf', 'x.csv')).toThrow(UnsupportedMediaError);
  });

  it('validateFileType rejects wrong extension', () => {
    expect(() => validateFileType('text/csv', 'x.pdf')).toThrow(UnsupportedMediaError);
  });

  it('parseFile yields CSV rows for .csv', async () => {
    const buf = Buffer.from(
      'customer_id,customer_email,customer_name,subject,description\n' +
        'c1,u@u.com,N,S,Description long enough.',
    );
    const rows: unknown[] = [];
    for await (const row of parseFile(buf, 'text/csv', 'data.csv')) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
  });

  it('parseFile throws UnsupportedMediaError for unknown extension', async () => {
    const iter = parseFile(Buffer.from('x'), 'text/plain', 'readme.txt');
    await expect(async () => {
      for await (const _ of iter) {
        /* empty */
      }
    }).rejects.toThrow(UnsupportedMediaError);
  });

  it('parseFile yields JSON rows for .json', async () => {
    const buf = Buffer.from(
      JSON.stringify([
        {
          customer_id: 'j1',
          customer_email: 'j@j.com',
          customer_name: 'J',
          subject: 'Subj',
          description: 'Description long enough for schema.',
        },
      ]),
    );
    const rows: unknown[] = [];
    for await (const row of parseFile(buf, 'application/json', 't.json')) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
  });

  it('parseFile propagates ImportParseError from invalid JSON file', async () => {
    const iter = parseFile(Buffer.from('{'), 'application/json', 'bad.json');
    await expect(async () => {
      for await (const _ of iter) {
        /* empty */
      }
    }).rejects.toThrow(ImportParseError);
  });

  it('parseFile yields XML rows for .xml', async () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>x1</customer_id>
    <customer_email>x@x.com</customer_email>
    <customer_name>X</customer_name>
    <subject>Subj</subject>
    <description>Description long enough for tests.</description>
  </ticket>
</tickets>`);
    const rows: unknown[] = [];
    for await (const row of parseFile(xml, 'application/xml', 'data.xml')) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_id: 'x1' });
  });
});
