import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Status } from '../../src/domain/ticket.types.js';
import { AppError } from '../../src/domain/errors.js';
import type { Ticket } from '../../src/domain/ticket.schema.js';

const mockFindByIdOrThrow = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../src/repositories/tickets.repository.js', () => ({
  ticketsRepository: {
    findByIdOrThrow: (...args: unknown[]) => mockFindByIdOrThrow(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn() },
}));

const { ticketsService } = await import('../../src/services/tickets.service.js');

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    customer_id: 'cust_1',
    customer_email: 'user@example.com',
    customer_name: 'User',
    subject: 'Subject line',
    description: 'Description long enough for validation.',
    category: 'other',
    priority: 'medium',
    status: Status.NEW,
    tags: [],
    created_at: new Date('2026-05-25T10:00:00.000Z'),
    updated_at: new Date('2026-05-25T10:00:00.000Z'),
    resolved_at: null,
    classification_confidence: null,
    classification_reasoning: null,
    classification_keywords: null,
    classification_overridden: false,
    assigned_to: null,
    source: null,
    browser: null,
    device_type: null,
    ...overrides,
  } as Ticket;
}

describe('TicketsService.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByIdOrThrow.mockResolvedValue(makeTicket());
    mockUpdate.mockImplementation(async (_id: string, data: Partial<Ticket>) =>
      makeTicket(data as Partial<Ticket>),
    );
  });

  it('clears resolved_at when reopening to new without explicit resolved_at', async () => {
    mockFindByIdOrThrow.mockResolvedValue(
      makeTicket({ status: Status.RESOLVED, resolved_at: new Date('2026-05-25T11:00:00.000Z') }),
    );

    await ticketsService.update('ticket-1', { status: Status.NEW });

    expect(mockUpdate).toHaveBeenCalledWith('ticket-1', {
      status: Status.NEW,
      resolved_at: null,
    });
  });

  it('clears resolved_at when reopening to in_progress without explicit resolved_at', async () => {
    mockFindByIdOrThrow.mockResolvedValue(
      makeTicket({ status: Status.CLOSED, resolved_at: new Date('2026-05-25T11:00:00.000Z') }),
    );

    await ticketsService.update('ticket-1', { status: Status.IN_PROGRESS });

    expect(mockUpdate).toHaveBeenCalledWith('ticket-1', {
      status: Status.IN_PROGRESS,
      resolved_at: null,
    });
  });

  it('sets resolved_at when marking resolved without explicit resolved_at', async () => {
    await ticketsService.update('ticket-1', { status: Status.RESOLVED });

    const payload = mockUpdate.mock.calls[0][1];
    expect(payload.status).toBe(Status.RESOLVED);
    expect(payload.resolved_at).toBeInstanceOf(Date);
  });

  it('throws when resolved_at is before created_at', async () => {
    mockFindByIdOrThrow.mockResolvedValue(
      makeTicket({ created_at: new Date('2026-05-25T12:00:00.000Z') }),
    );

    await expect(
      ticketsService.update('ticket-1', {
        resolved_at: new Date('2026-05-25T10:00:00.000Z'),
      }),
    ).rejects.toThrow(AppError);

    await expect(
      ticketsService.update('ticket-1', {
        resolved_at: new Date('2026-05-25T10:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'resolved_at cannot be before created_at',
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
