import { ImportParseError } from '../domain/errors.js';

export async function* parseJson(buffer: Buffer): AsyncIterable<unknown> {
  try {
    const text = buffer.toString('utf-8');
    const data = JSON.parse(text);

    if (!Array.isArray(data)) {
      throw new Error('JSON root must be an array');
    }

    for (const item of data) {
      yield item;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ImportParseError(`JSON parse error: ${message}`);
  }
}
