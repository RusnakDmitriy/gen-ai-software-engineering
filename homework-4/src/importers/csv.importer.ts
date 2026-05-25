import { parse } from 'csv-parse';
import { Readable } from 'stream';
import { ImportParseError } from '../domain/errors.js';

export async function* parseCsv(buffer: Buffer): AsyncIterable<Record<string, string>> {
  try {
    const readable = Readable.from([buffer]);
    const parser = readable.pipe(
      parse({
        bom: true,
        columns: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: false,
        cast: false,
      }),
    );

    for await (const row of parser) {
      yield row as Record<string, string>;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ImportParseError(`CSV parse error: ${message}`);
  }
}
