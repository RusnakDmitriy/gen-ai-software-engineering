import type {
  TicketCreate,
  TicketQuery,
  Ticket,
  TicketUpdate,
  ClassificationResult,
} from '../domain/ticket.schema.js';
import { ticketsRepository } from '../repositories/tickets.repository.js';
import { classificationService } from './classification.service.js';
import { logger } from '../config/logger.js';
import { ClassificationOverriddenError } from '../domain/errors.js';

export class TicketsService {
  async create(data: TicketCreate, options?: { autoClassify?: boolean }): Promise<Ticket> {
    let ticketData: TicketCreate = { ...data };

    if (options?.autoClassify) {
      const classification = classificationService.classify(
        `${data.subject} ${data.description}`,
      );
      ticketData = {
        ...ticketData,
        category: classification.category,
        priority: classification.priority,
      };

      logger.info(
        {
          category: classification.category,
          priority: classification.priority,
          confidence: classification.confidence,
          keywords: classification.keywords,
        },
        'auto-classify on create',
      );
    }

    const ticket = await ticketsRepository.create(ticketData);
    logger.info({ ticketId: ticket.id }, 'ticket created');
    return ticket;
  }

  async findById(id: string): Promise<Ticket | null> {
    return ticketsRepository.findById(id);
  }

  async list(query: TicketQuery): Promise<{ data: Ticket[]; total: number }> {
    return ticketsRepository.findMany(query);
  }

  async update(id: string, data: Partial<TicketUpdate>): Promise<Ticket> {
    await ticketsRepository.findByIdOrThrow(id);

    let payload: Partial<TicketUpdate> = data;
    if (data.status !== undefined && ['resolved', 'closed'].includes(data.status)) {
      if (data.resolved_at === undefined) {
        payload = { ...data, resolved_at: new Date() };
      }
    }

    const updated = await ticketsRepository.update(id, payload);
    logger.info({ ticketId: id }, 'ticket updated');
    return updated;
  }

  async delete(id: string): Promise<void> {
    await ticketsRepository.findByIdOrThrow(id);
    await ticketsRepository.delete(id);
    logger.info({ ticketId: id }, 'ticket deleted');
  }

  async autoClassify(id: string, options?: { force?: boolean }): Promise<ClassificationResult> {
    const ticket = await ticketsRepository.findByIdOrThrow(id);

    if (ticket.classification_overridden && !options?.force) {
      throw new ClassificationOverriddenError();
    }

    const classification = classificationService.classify(
      `${ticket.subject} ${ticket.description}`,
    );

    await ticketsRepository.update(id, {
      category: classification.category,
      priority: classification.priority,
      classification_confidence: classification.confidence,
      classification_reasoning: classification.reasoning,
      classification_keywords: classification.keywords,
    });

    logger.info(
      {
        ticketId: id,
        category: classification.category,
        priority: classification.priority,
        confidence: classification.confidence,
        keywords: classification.keywords,
      },
      'auto-classify explicit',
    );

    return classification;
  }

  async bulkCreate(
    records: TicketCreate[],
    options?: { autoClassify?: boolean },
  ): Promise<number> {
    let finalRecords: TicketCreate[] = records;

    if (options?.autoClassify) {
      finalRecords = records.map((record) => {
        const classification = classificationService.classify(
          `${record.subject} ${record.description}`,
        );
        return {
          ...record,
          category: classification.category,
          priority: classification.priority,
        };
      });
    }

    const count = await ticketsRepository.createMany(finalRecords);
    logger.info({ count }, 'bulk create completed');
    return count;
  }
}

export const ticketsService = new TicketsService();
