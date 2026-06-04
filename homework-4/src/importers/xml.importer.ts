import { XMLParser } from 'fast-xml-parser';
import { ImportParseError } from '../domain/errors.js';

interface ParsedTicketsRoot {
  tickets?: {
    ticket?: Record<string, unknown> | Record<string, unknown>[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenXmlObject(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};

  Object.entries(obj).forEach(([key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result[newKey] = '';
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenXmlObject(value as Record<string, unknown>, newKey));
    } else if (Array.isArray(value)) {
      result[newKey] = value.map((v) => String(v)).join(',');
    } else {
      result[newKey] = String(value);
    }
  });

  if (result['metadata.source'] !== undefined) {
    result['source'] = result['metadata.source'];
  }
  if (result['metadata.browser'] !== undefined) {
    result['browser'] = result['metadata.browser'];
  }
  if (result['metadata.device_type'] !== undefined) {
    result['device_type'] = result['metadata.device_type'];
  }

  return result;
}

export async function* parseXml(buffer: Buffer): AsyncIterable<Record<string, string>> {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      allowBooleanAttributes: true,
    });

    const text = buffer.toString('utf-8');
    const parsed: unknown = parser.parse(text);

    if (!isRecord(parsed)) {
      throw new Error('XML root must be an object');
    }

    const root = parsed as ParsedTicketsRoot;
    if (!root.tickets) {
      throw new Error('XML must have a root <tickets> element');
    }

    if (!root.tickets.ticket) {
      return;
    }

    const ticketNodes = root.tickets.ticket;
    const tickets = Array.isArray(ticketNodes) ? ticketNodes : [ticketNodes];

    for (const ticket of tickets) {
      if (isRecord(ticket)) {
        yield flattenXmlObject(ticket);
      }
    }
  } catch (err) {
    if (err instanceof ImportParseError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ImportParseError(`XML parse error: ${message}`);
  }
}
