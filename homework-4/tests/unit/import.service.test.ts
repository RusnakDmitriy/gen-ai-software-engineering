import { describe, it, expect, vi, afterEach } from 'vitest';
import { importService } from '../../src/services/import.service.js';
import { ticketsService } from '../../src/services/tickets.service.js';

describe('ImportService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call bulkCreate when the file parses to zero rows', async () => {
    const spy = vi.spyOn(ticketsService, 'bulkCreate').mockResolvedValue(0);
    const res = await importService.importFile(Buffer.from('[]'), 'application/json', 'empty.json');
    expect(res.total).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('normalizes pipe-separated tags before validation', async () => {
    const spy = vi.spyOn(ticketsService, 'bulkCreate').mockResolvedValue(1);
    const buf = Buffer.from(
      JSON.stringify([
        {
          customer_id: 'tg',
          customer_email: 'tg@tg.com',
          customer_name: 'TG',
          subject: 'Subject line',
          description: 'Description long enough.',
          tags: 'alpha | beta',
        },
      ]),
    );
    const res = await importService.importFile(buf, 'application/json', 'tags.json');
    expect(res.successful).toBe(1);
    expect(spy).toHaveBeenCalledOnce();
    const records = spy.mock.calls[0][0];
    expect(records[0].tags).toEqual(['alpha', 'beta']);
  });

  it('passes autoClassify option through to bulkCreate', async () => {
    const spy = vi.spyOn(ticketsService, 'bulkCreate').mockResolvedValue(1);
    const buf = Buffer.from(
      JSON.stringify([
        {
          customer_id: 'ac',
          customer_email: 'ac@ac.com',
          customer_name: 'AC',
          subject: 'invoice payment',
          description: 'Billing question about payment and invoice.',
        },
      ]),
    );
    await importService.importFile(buf, 'application/json', 'c.json', { autoClassify: true });
    expect(spy).toHaveBeenCalledWith(expect.any(Array), { autoClassify: true });
  });
});
