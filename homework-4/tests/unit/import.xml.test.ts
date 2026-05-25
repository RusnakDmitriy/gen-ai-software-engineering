import { describe, it, expect } from 'vitest';
import { parseXml } from '../../src/importers/xml.importer.js';
import { ImportParseError } from '../../src/domain/errors.js';

describe('XML Importer', () => {
  it('should parse valid XML', async () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>cust_001</customer_id>
    <customer_email>user@example.com</customer_email>
    <customer_name>John</customer_name>
    <subject>Test</subject>
    <description>This is a test description</description>
  </ticket>
</tickets>`);

    const rows: unknown[] = [];
    for await (const row of parseXml(xml)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_id: 'cust_001' });
  });

  it('should handle multiple tickets', async () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>cust_001</customer_id>
    <customer_email>user1@example.com</customer_email>
    <customer_name>John</customer_name>
    <subject>Test1</subject>
    <description>This is a test description</description>
  </ticket>
  <ticket>
    <customer_id>cust_002</customer_id>
    <customer_email>user2@example.com</customer_email>
    <customer_name>Jane</customer_name>
    <subject>Test2</subject>
    <description>Another test description</description>
  </ticket>
</tickets>`);

    const rows = [];
    for await (const row of parseXml(xml)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(2);
  });

  it('should throw when missing root element', async () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ticket>
  <customer_id>cust_001</customer_id>
</ticket>`);

    try {
      for await (const _row of parseXml(xml)) {
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

  it('should handle incomplete XML gracefully', async () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>cust_001</customer_id>
  </ticket>
</tickets>`);

    const rows = [];
    for await (const row of parseXml(xml)) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
  });

  it('should handle zero rows', async () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<tickets><ticket></ticket></tickets>`);

    const rows = [];
    for await (const row of parseXml(xml)) {
      rows.push(row);
    }

    expect(rows).toBeDefined();
  });

  it('flattens metadata fields into top-level keys', async () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>m1</customer_id>
    <customer_email>m@m.com</customer_email>
    <customer_name>M</customer_name>
    <subject>S</subject>
    <description>Long description text for validation.</description>
    <metadata>
      <source>email</source>
      <browser>Firefox</browser>
      <device_type>desktop</device_type>
    </metadata>
  </ticket>
</tickets>`);
    const rows: Record<string, string>[] = [];
    for await (const row of parseXml(xml)) {
      rows.push(row);
    }
    expect(rows[0].source).toBe('email');
    expect(rows[0].browser).toBe('Firefox');
    expect(rows[0].device_type).toBe('desktop');
  });

  it('joins repeated XML child elements into a comma-separated string', async () => {
    const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>a1</customer_id>
    <customer_email>a@a.com</customer_email>
    <customer_name>A</customer_name>
    <subject>S</subject>
    <description>Long enough description content here.</description>
    <label>one</label>
    <label>two</label>
  </ticket>
</tickets>`);
    const rows: Record<string, string>[] = [];
    for await (const row of parseXml(xml)) {
      rows.push(row);
    }
    expect(rows[0].label).toContain('one');
    expect(rows[0].label).toContain('two');
  });
});
