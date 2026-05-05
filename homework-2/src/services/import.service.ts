import { TicketCreateSchema, type TicketCreate } from '../domain/ticket.schema.js';
import { parseFile } from '../importers/index.js';
import { ticketsService } from './tickets.service.js';
import { logger } from '../config/logger.js';

export interface ImportResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ImportService {
  async importFile(
    buffer: Buffer,
    mimeType: string,
    filename: string,
    options?: { autoClassify?: boolean },
  ): Promise<ImportResult> {
    const result: ImportResult = {
      total: 0,
      successful: 0,
      failed: 0,
      errors: [],
    };

    const validRecords: TicketCreate[] = [];
    let rowNumber = 0;

    for await (const row of parseFile(buffer, mimeType, filename)) {
      rowNumber++;
      result.total++;

      if (isRecord(row)) {
        const tags = row['tags'];
        if (typeof tags === 'string') {
          row['tags'] = tags.split('|').map((t) => t.trim());
        }
      }

      const parseResult = TicketCreateSchema.safeParse(row);

      if (parseResult.success) {
        validRecords.push(parseResult.data);
        result.successful++;
      } else {
        result.failed++;
        const errors = parseResult.error.errors;
        errors.forEach((err) => {
          result.errors.push({
            row: rowNumber,
            field: err.path.join('.'),
            message: err.message,
          });
        });
      }
    }

    if (validRecords.length > 0) {
      await ticketsService.bulkCreate(validRecords, options);
      logger.info(
        { successful: result.successful, failed: result.failed },
        'bulk import completed',
      );
    }

    return result;
  }
}

export const importService = new ImportService();
