import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { Category, Priority } from '../../src/domain/ticket.types.js';

const app = createApp();
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

const baseTicket = {
  customer_email: 'flow@example.com',
  customer_name: 'Flow User',
  subject: 'Workflow subject line',
  description: 'Description long enough for schema validation rules.',
};

describe('End-to-end workflows (integration)', () => {
  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  it('full lifecycle: create → get → update → auto-classify → resolve with resolved_at', async () => {
    const createRes = await request(app)
      .post('/tickets')
      .send({ ...baseTicket, customer_id: 'life_1' });
    expect(createRes.status).toBe(201);
    const id = createRes.body.data.id as string;

    const getRes = await request(app).get(`/tickets/${id}`);
    expect(getRes.status).toBe(200);

    await request(app).put(`/tickets/${id}`).send({ status: 'in_progress' }).expect(200);

    const classifyRes = await request(app).post(`/tickets/${id}/auto-classify`);
    expect(classifyRes.status).toBe(200);
    expect(classifyRes.body.data).toMatchObject({
      category: expect.any(String),
      priority: expect.any(String),
      confidence: expect.any(Number),
      reasoning: expect.any(String),
    });

    const resolved = await request(app).put(`/tickets/${id}`).send({ status: 'resolved' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.resolved_at).not.toBeNull();
  });

  it('bulk import CSV with auto_classify returns successful count', async () => {
    const csvPath = path.join(fixturesDir, 'sample_tickets.csv');
    const buf = readFileSync(csvPath);
    const res = await request(app)
      .post('/tickets/import?auto_classify=true')
      .attach('file', buf, { filename: 'sample_tickets.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.data.successful).toBe(50);
    expect(res.body.data.failed).toBe(0);

    const list = await prisma.ticket.findMany({ take: 5 });
    expect(list.length).toBeGreaterThan(0);
  });

  it('concurrent POST /tickets: 20 requests all succeed with unique ids', async () => {
    const bodies = Array.from({ length: 20 }, (_, i) => ({
      ...baseTicket,
      customer_id: `conc_${i}`,
      subject: `Subject ${i}`,
    }));

    const responses = await Promise.all(
      bodies.map((body) => request(app).post('/tickets').send(body)),
    );

    responses.forEach((r) => expect(r.status).toBe(201));
    const ids = new Set(responses.map((r) => r.body.data.id as string));
    expect(ids.size).toBe(20);
  });

  it('combined category + priority + pagination filters expected rows', async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.ticket.create({
        data: {
          customer_id: `combo_${i}`,
          customer_email: `u${i}@x.cm`,
          customer_name: 'U',
          subject: `Ticket ${i}`,
          description: 'Need help with billing invoice payment question here.',
          category: Category.BILLING_QUESTION,
          priority: i % 2 === 0 ? Priority.HIGH : Priority.MEDIUM,
          status: 'new',
          tags: '[]',
        },
      });
    }

    const res = await request(app).get('/tickets').query({
      category: 'billing_question',
      priority: 'high',
      page: 1,
      pageSize: 10,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    res.body.data.forEach(
      (row: { category: string; priority: string }) => {
        expect(row.category).toBe('billing_question');
        expect(row.priority).toBe('high');
      },
    );
  });

  it('partial import: mixed valid and invalid rows reports counts and errors', async () => {
    const csv =
      'customer_id,customer_email,customer_name,subject,description\n' +
      'ok1,ok@example.com,Name,Subj,Valid description row one here.\n' +
      'ok2,ok2@example.com,Name,Subj2,Valid description row two here.\n' +
      'bad,bad-email,Name,Subj3,Invalid email row description.\n';

    const res = await request(app)
      .post('/tickets/import')
      .attach('file', Buffer.from(csv), { filename: 'mixed.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.data.successful).toBe(2);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.errors.length).toBeGreaterThanOrEqual(1);
  });
});
