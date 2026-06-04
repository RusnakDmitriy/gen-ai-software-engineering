import { bench, describe, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { categorize } from '../../src/classification/rules.js';

const app = createApp();

const validTicketBase = {
  customer_email: 'perf@example.com',
  customer_name: 'Perf User',
  subject: 'Performance benchmark ticket subject line',
  description:
    'This description is long enough for the schema validation rules we use in the ticket API.',
};

function makeCsv1000Buffer(): Buffer {
  const lines = ['customer_id,customer_email,customer_name,subject,description'];
  for (let i = 0; i < 1000; i++) {
    lines.push(`c${i},u${i}@p.com,N,Subj,Description long enough for CSV row ${i}.`);
  }
  return Buffer.from(lines.join('\n'));
}

const csv1000 = makeCsv1000Buffer();

describe('Task 3 performance benchmarks', { timeout: 180_000 }, () => {
  beforeAll(async () => {
    await prisma.ticket.deleteMany();

    const batchSize = 500;
    const rows: Array<{
      customer_id: string;
      customer_email: string;
      customer_name: string;
      subject: string;
      description: string;
      category: string;
      priority: string;
      status: string;
      tags: string;
    }> = [];

    for (let n = 0; n < 10_000; n++) {
      rows.push({
        customer_id: `seed10k_${n}`,
        customer_email: `s${n}@s.com`,
        customer_name: 'S',
        subject: `Subject ${n}`,
        description: 'Description long enough for all seeded tickets in benchmark suite.',
        category: n % 3 === 0 ? 'other' : 'billing_question',
        priority: 'medium',
        status: 'new',
        tags: '[]',
      });
    }

    for (let i = 0; i < rows.length; i += batchSize) {
      await prisma.ticket.createMany({ data: rows.slice(i, i + batchSize) });
    }
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({
      where: {
        OR: [
          { customer_id: { startsWith: 'seed10k_' } },
          { customer_id: { startsWith: 'perf_bench_' } },
        ],
      },
    });
  });

  bench(
    'HTTP: single POST /tickets create',
    async () => {
      const id = randomUUID();
      const res = await request(app)
        .post('/tickets')
        .send({
          customer_id: `perf_bench_${id}`,
          ...validTicketBase,
        });
      if (res.status !== 201) {
        throw new Error(`expected 201, got ${res.status}`);
      }
    },
    { time: 2000 },
  );

  bench(
    'Throughput: sync parse 1000-row CSV (csv-parse)',
    () => {
      const records = parse(csv1000, {
        bom: true,
        columns: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: false,
        cast: false,
      }) as Record<string, string>[];
      if (records.length !== 1000) {
        throw new Error(`expected 1000 rows, got ${records.length}`);
      }
    },
    { time: 3000 },
  );

  bench(
    'Pure: categorize() hot path',
    () => {
      categorize('login password critical production issue billing payment refund');
    },
    { time: 2000 },
  );

  bench(
    'HTTP: GET /tickets with 10k rows + category filter',
    async () => {
      const res = await request(app).get('/tickets').query({
        category: 'other',
        page: 1,
        pageSize: 20,
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status}`);
      }
    },
    { time: 2000 },
  );

  bench(
    'HTTP: 100 concurrent GET /health',
    async () => {
      const results = await Promise.all(
        Array.from({ length: 100 }, () => request(app).get('/health')),
      );
      const failed = results.filter((r) => r.status !== 200);
      if (failed.length > 0) {
        throw new Error(`${failed.length} requests failed`);
      }
    },
    { time: 3000 },
  );
});
