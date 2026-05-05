import path from 'path';
import { UnsupportedMediaError } from '../domain/errors.js';
import { parseCsv } from './csv.importer.js';
import { parseJson } from './json.importer.js';
import { parseXml } from './xml.importer.js';

const ACCEPTED_MIMES = new Set([
  'text/csv',
  'application/csv',
  'application/json',
  'application/xml',
  'text/xml',
]);

const ACCEPTED_EXTENSIONS = new Set(['.csv', '.json', '.xml']);

export function validateFileType(mimeType: string, filename: string): void {
  const ext = path.extname(filename).toLowerCase();

  if (!ACCEPTED_MIMES.has(mimeType) || !ACCEPTED_EXTENSIONS.has(ext)) {
    throw new UnsupportedMediaError(mimeType, [...ACCEPTED_MIMES]);
  }
}

export async function* parseFile(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): AsyncIterable<unknown> {
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.csv') {
    yield* parseCsv(buffer);
  } else if (ext === '.json') {
    yield* parseJson(buffer);
  } else if (ext === '.xml') {
    yield* parseXml(buffer);
  } else {
    throw new UnsupportedMediaError(mimeType, [...ACCEPTED_MIMES]);
  }
}
