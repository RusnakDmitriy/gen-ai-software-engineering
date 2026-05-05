import type { Prisma, Ticket as PrismaTicket } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import type { TicketCreate, TicketQuery, Ticket, TicketUpdate } from '../domain/ticket.schema.js';
import { NotFoundError } from '../domain/errors.js';

const SORTABLE_FIELDS = [
  'created_at',
  'updated_at',
  'priority',
  'status',
  'subject',
] as const;

type SortableField = (typeof SORTABLE_FIELDS)[number];

function isSortableField(value: string): value is SortableField {
  return (SORTABLE_FIELDS as readonly string[]).includes(value);
}

function ticketCreateToPrismaInput(data: TicketCreate): Prisma.TicketCreateInput {
  const { metadata, ...rest } = data;
  const source = rest.source ?? metadata?.source ?? undefined;
  const browser = rest.browser ?? metadata?.browser ?? undefined;
  const device_type = rest.device_type ?? metadata?.device_type ?? undefined;

  return {
    customer_id: rest.customer_id,
    customer_email: rest.customer_email,
    customer_name: rest.customer_name,
    subject: rest.subject,
    description: rest.description,
    category: rest.category,
    priority: rest.priority,
    status: rest.status,
    assigned_to: rest.assigned_to ?? undefined,
    tags: JSON.stringify(rest.tags ?? []),
    source: source ?? undefined,
    browser: browser ?? undefined,
    device_type: device_type ?? undefined,
  };
}

function ticketCreateToManyInput(data: TicketCreate): Prisma.TicketCreateManyInput {
  const flat = ticketCreateToPrismaInput(data);
  return {
    customer_id: flat.customer_id as string,
    customer_email: flat.customer_email as string,
    customer_name: flat.customer_name as string,
    subject: flat.subject as string,
    description: flat.description as string,
    category: flat.category as string,
    priority: flat.priority as string,
    status: flat.status as string,
    assigned_to: flat.assigned_to ?? null,
    tags: flat.tags as string,
    source: flat.source ?? null,
    browser: flat.browser ?? null,
    device_type: flat.device_type ?? null,
  };
}

function ticketUpdateToPrismaInput(data: Partial<TicketUpdate>): Prisma.TicketUpdateInput {
  const result: Prisma.TicketUpdateInput = {};

  if (data.metadata !== undefined) {
    const m = data.metadata;
    if (m.source !== undefined) result.source = m.source;
    if (m.browser !== undefined) result.browser = m.browser;
    if (m.device_type !== undefined) result.device_type = m.device_type;
  }

  if (data.subject !== undefined) result.subject = data.subject;
  if (data.description !== undefined) result.description = data.description;
  if (data.category !== undefined) result.category = data.category;
  if (data.priority !== undefined) result.priority = data.priority;
  if (data.status !== undefined) result.status = data.status;
  if (data.assigned_to !== undefined) result.assigned_to = data.assigned_to;
  if (data.tags !== undefined) result.tags = JSON.stringify(data.tags);
  if (data.resolved_at !== undefined) result.resolved_at = data.resolved_at;
  if (data.classification_confidence !== undefined) {
    result.classification_confidence = data.classification_confidence;
  }
  if (data.classification_reasoning !== undefined) {
    result.classification_reasoning = data.classification_reasoning;
  }
  if (data.classification_overridden !== undefined) {
    result.classification_overridden = data.classification_overridden;
  }

  if (data.classification_keywords !== undefined) {
    result.classification_keywords = data.classification_keywords
      ? JSON.stringify(data.classification_keywords)
      : null;
  }

  if (data.source !== undefined) result.source = data.source;
  if (data.browser !== undefined) result.browser = data.browser;
  if (data.device_type !== undefined) result.device_type = data.device_type;

  return result;
}

function parseTagsFromDb(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseClassificationKeywordsFromDb(raw: string | null): string[] | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return null;
  }
}

function mapPrismaToTicket(record: PrismaTicket): Ticket {
  return {
    id: record.id,
    customer_id: record.customer_id,
    customer_email: record.customer_email,
    customer_name: record.customer_name,
    subject: record.subject,
    description: record.description,
    category: record.category as Ticket['category'],
    priority: record.priority as Ticket['priority'],
    status: record.status as Ticket['status'],
    created_at: record.created_at,
    updated_at: record.updated_at,
    resolved_at: record.resolved_at,
    assigned_to: record.assigned_to,
    tags: parseTagsFromDb(record.tags),
    source: record.source as Ticket['source'],
    browser: record.browser,
    device_type: record.device_type as Ticket['device_type'],
    classification_confidence: record.classification_confidence,
    classification_reasoning: record.classification_reasoning,
    classification_keywords: parseClassificationKeywordsFromDb(record.classification_keywords),
    classification_overridden: record.classification_overridden,
  };
}

export class TicketsRepository {
  async create(data: TicketCreate): Promise<Ticket> {
    const prismaData = ticketCreateToPrismaInput(data);
    const record = await prisma.ticket.create({
      data: prismaData,
    });
    return mapPrismaToTicket(record);
  }

  async findById(id: string): Promise<Ticket | null> {
    const record = await prisma.ticket.findUnique({
      where: { id },
    });
    return record ? mapPrismaToTicket(record) : null;
  }

  async findMany(query: TicketQuery): Promise<{ data: Ticket[]; total: number }> {
    const { category, priority, status, assigned_to, q, page, pageSize, sort, order } = query;

    const where: Prisma.TicketWhereInput = {};
    if (category) where.category = category;
    if (priority) where.priority = priority;
    if (status) where.status = status;
    if (assigned_to) where.assigned_to = assigned_to;
    if (q) {
      where.OR = [{ subject: { contains: q } }, { description: { contains: q } }];
    }

    const sortKey = isSortableField(sort) ? sort : 'created_at';
    const orderBy: Prisma.TicketOrderByWithRelationInput = {
      [sortKey]: order,
    };

    const [records, total] = await prisma.$transaction([
      prisma.ticket.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.ticket.count({ where }),
    ]);

    return {
      data: records.map(mapPrismaToTicket),
      total,
    };
  }

  async createMany(records: TicketCreate[]): Promise<number> {
    const prismaRecords = records.map(ticketCreateToManyInput);
    const result = await prisma.ticket.createMany({
      data: prismaRecords,
    });
    return result.count;
  }

  async update(id: string, data: Partial<TicketUpdate>): Promise<Ticket> {
    const prismaData = ticketUpdateToPrismaInput(data);
    const record = await prisma.ticket.update({
      where: { id },
      data: prismaData,
    });
    return mapPrismaToTicket(record);
  }

  async delete(id: string): Promise<void> {
    await prisma.ticket.delete({
      where: { id },
    });
  }

  async findByIdOrThrow(id: string): Promise<Ticket> {
    const ticket = await this.findById(id);
    if (!ticket) {
      throw new NotFoundError('Ticket', id);
    }
    return ticket;
  }
}

export const ticketsRepository = new TicketsRepository();
