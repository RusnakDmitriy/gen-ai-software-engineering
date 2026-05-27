import { z } from 'zod';
import { Category, Priority, Status, Source, DeviceType } from './ticket.types.js';

function emptyToUndefined(value: unknown): unknown {
  if (value === '' || value === null) return undefined;
  return value;
}

export const TicketMetadataSchema = z.object({
  source: z.preprocess(emptyToUndefined, z.nativeEnum(Source).optional()),
  browser: z.preprocess(emptyToUndefined, z.string().max(255).optional().nullable()),
  device_type: z.preprocess(emptyToUndefined, z.nativeEnum(DeviceType).optional().nullable()),
});

export const TicketCreateSchema = z.object({
  customer_id: z.string().min(1, 'customer_id is required'),
  customer_email: z.string().email('Invalid email format'),
  customer_name: z.string().min(1, 'customer_name is required'),
  subject: z.string().min(1, 'subject must be at least 1 character').max(200, 'subject must be at most 200 characters'),
  description: z.string().min(10, 'description must be at least 10 characters').max(2000, 'description must be at most 2000 characters'),
  category: z.nativeEnum(Category).default(Category.OTHER),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  status: z.nativeEnum(Status).default(Status.NEW),
  assigned_to: z.preprocess(emptyToUndefined, z.string().nullable().optional()),
  tags: z.array(z.string()).default([]),
  source: z.preprocess(emptyToUndefined, z.nativeEnum(Source).optional().nullable()),
  browser: z.preprocess(emptyToUndefined, z.string().max(255).optional().nullable()),
  device_type: z.preprocess(emptyToUndefined, z.nativeEnum(DeviceType).optional().nullable()),
  metadata: TicketMetadataSchema.optional(),
});

export type TicketCreate = z.infer<typeof TicketCreateSchema>;

export const TicketUpdateSchema = TicketCreateSchema.partial().omit({
  customer_id: true,
  customer_email: true,
  customer_name: true,
}).extend({
  resolved_at: z.coerce.date().optional().nullable(),
  classification_confidence: z.number().optional().nullable(),
  classification_reasoning: z.string().optional().nullable(),
  classification_keywords: z.array(z.string()).optional().nullable(),
  classification_overridden: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.resolved_at && data.resolved_at !== null) {
      const now = new Date();
      return data.resolved_at <= now;
    }
    return true;
  },
  { message: 'resolved_at cannot be in the future' }
);

export type TicketUpdate = z.infer<typeof TicketUpdateSchema>;

export const TicketSchema = TicketCreateSchema.extend({
  id: z.string().min(1),
  created_at: z.date(),
  updated_at: z.date(),
  resolved_at: z.coerce.date().nullable(),
  classification_confidence: z.number().min(0).max(1).nullable(),
  classification_reasoning: z.string().nullable(),
  classification_keywords: z.array(z.string()).nullable(),
  classification_overridden: z.boolean().default(false),
});

export type Ticket = z.infer<typeof TicketSchema>;

export const TicketQuerySchema = z.object({
  category: z.nativeEnum(Category).optional(),
  priority: z.nativeEnum(Priority).optional(),
  status: z.nativeEnum(Status).optional(),
  assigned_to: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type TicketQuery = z.infer<typeof TicketQuerySchema>;

export const ClassificationResultSchema = z.object({
  category: z.nativeEnum(Category),
  priority: z.nativeEnum(Priority),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  keywords: z.array(z.string()),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
