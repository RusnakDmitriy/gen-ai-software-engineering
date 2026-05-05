import { describe, it, expect, vi, afterEach } from 'vitest';
import { importService } from '../../src/services/import.service.js';
import { ticketsService } from '../../src/services/tickets.service.js';

describe('import smoke (for perf bench)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('importService completes 1000 CSV rows with bulkCreate mocked', async () => {
    vi.spyOn(ticketsService, 'bulkCreate').mockResolvedValue(1000);
    const lines = ['customer_id,customer_email,customer_name,subject,description'];
    for (let i = 0; i < 1000; i++) {
      lines.push(`c${i},u${i}@p.com,N,Subj,Description long enough for CSV row ${i}.`);
    }
    const buf = Buffer.from(lines.join('\n'));
    const r = await importService.importFile(buf, 'text/csv', 'smoke.csv');
    expect(r.total).toBe(1000);
    expect(r.successful).toBe(1000);
    expect(r.failed).toBe(0);
  });
});
