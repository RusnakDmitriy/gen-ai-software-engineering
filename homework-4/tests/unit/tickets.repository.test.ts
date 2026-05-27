import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../../src/db/prisma.js', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    ticket: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
  },
}));

const { ticketsRepository } = await import('../../src/repositories/tickets.repository.js');

describe('TicketsRepository.findMany', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  });

  it('uses case-insensitive contains filter when q is provided', async () => {
    await ticketsRepository.findMany({
      q: 'Login',
      page: 1,
      pageSize: 20,
      sort: 'created_at',
      order: 'desc',
    });

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { subject: { contains: 'Login', mode: 'insensitive' } },
            { description: { contains: 'Login', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });
});
