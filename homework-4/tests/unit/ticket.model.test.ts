import { describe, it, expect } from 'vitest';
import { TicketCreateSchema, TicketQuerySchema, TicketUpdateSchema } from '../../src/domain/ticket.schema.js';
import { Category, Priority, Status } from '../../src/domain/ticket.types.js';

describe('Ticket Model - TicketCreateSchema', () => {
  it('should pass validation with all required fields', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
      description: 'I have been unable to access my account for 2 days.',
    });
    expect(result.success).toBe(true);
  });

  it('should fail when required field missing', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
    });
    expect(result.success).toBe(false);
  });

  it('should fail on invalid email', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'invalid-email',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
      description: 'I have been unable to access my account.',
    });
    expect(result.success).toBe(false);
  });

  it('should fail when subject is empty', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: '',
      description: 'I have been unable to access my account.',
    });
    expect(result.success).toBe(false);
  });

  it('should fail when subject exceeds 200 characters', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'a'.repeat(201),
      description: 'I have been unable to access my account.',
    });
    expect(result.success).toBe(false);
  });

  it('should fail when description is less than 10 characters', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
      description: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('should fail when description exceeds 2000 characters', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
      description: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('should fail on invalid category', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
      description: 'I have been unable to access my account.',
      category: 'invalid_category',
    });
    expect(result.success).toBe(false);
  });

  it('should default category to other', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
      description: 'I have been unable to access my account.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe(Category.OTHER);
    }
  });

  it('should default priority to medium', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
      description: 'I have been unable to access my account.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(Priority.MEDIUM);
    }
  });

  it('should default status to new', () => {
    const result = TicketCreateSchema.safeParse({
      customer_id: 'cust_001',
      customer_email: 'user@example.com',
      customer_name: 'John Doe',
      subject: 'Cannot log in',
      description: 'I have been unable to access my account.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(Status.NEW);
    }
  });
});

describe('Ticket Model - TicketQuerySchema', () => {
  it('should parse valid query parameters', () => {
    const result = TicketQuerySchema.safeParse({
      category: Category.BILLING_QUESTION,
      priority: Priority.HIGH,
      page: 1,
      pageSize: 20,
    });
    expect(result.success).toBe(true);
  });

  it('should default page to 1', () => {
    const result = TicketQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
    }
  });

  it('should default pageSize to 20', () => {
    const result = TicketQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe(20);
    }
  });

  it('should fail when pageSize exceeds 100', () => {
    const result = TicketQuerySchema.safeParse({
      pageSize: 101,
    });
    expect(result.success).toBe(false);
  });
});

describe('Ticket Model - TicketUpdateSchema', () => {
  it('coerces ISO string resolved_at to Date', () => {
    const result = TicketUpdateSchema.safeParse({
      resolved_at: '2026-05-25T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resolved_at).toBeInstanceOf(Date);
    }
  });

  it('rejects resolved_at in the future', () => {
    const future = new Date(Date.now() + 60_000);
    const result = TicketUpdateSchema.safeParse({ resolved_at: future });
    expect(result.success).toBe(false);
  });

  it('accepts resolved_at in the past', () => {
    const past = new Date(Date.now() - 60_000);
    const result = TicketUpdateSchema.safeParse({ resolved_at: past });
    expect(result.success).toBe(true);
  });
});
