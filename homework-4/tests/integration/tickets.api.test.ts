import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { Category } from '../../src/domain/ticket.types.js';

const app = createApp();

const validTicket = {
  customer_id: 'api_cust_1',
  customer_email: 'customer@example.com',
  customer_name: 'API Customer',
  subject: 'Need help with login',
  description: 'I cannot log in to my account since yesterday morning.',
};

describe('Tickets API (integration)', () => {
  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  it('GET /health returns 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptime).toBe('number');
  });

  it('POST /tickets with valid body returns 201 and persisted ticket', async () => {
    const res = await request(app).post('/tickets').send(validTicket);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      customer_id: validTicket.customer_id,
      customer_email: validTicket.customer_email,
      subject: validTicket.subject,
    });
    expect(res.body.data.id).toBeTruthy();
  });

  it('POST /tickets with missing required field returns 400 with details', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ ...validTicket, customer_email: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('POST /tickets?auto_classify=true sets category and priority from classifier', async () => {
    const res = await request(app)
      .post('/tickets?auto_classify=true')
      .send({
        ...validTicket,
        customer_id: 'classify_1',
        subject: 'Production is down critical',
        description: 'Production environment is completely down urgent issue here.',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toBeDefined();
    expect(res.body.data.priority).toBeDefined();
  });

  it('GET /tickets returns paginated list', async () => {
    await request(app).post('/tickets').send({ ...validTicket, customer_id: 'p1' });
    await request(app).post('/tickets').send({
      ...validTicket,
      customer_id: 'p2',
      subject: 'Second subject line',
    });

    const res = await request(app).get('/tickets').query({ page: 1, pageSize: 10 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 2,
    });
  });

  it('GET /tickets?category= filters to matching tickets', async () => {
    await prisma.ticket.create({
      data: {
        customer_id: 'seed1',
        customer_email: 'a@a.com',
        customer_name: 'A',
        subject: 'Billing help',
        description: 'Question about invoice and payment billing.',
        category: Category.BILLING_QUESTION,
        priority: 'medium',
        status: 'new',
        tags: '[]',
      },
    });
    await prisma.ticket.create({
      data: {
        customer_id: 'seed2',
        customer_email: 'b@b.com',
        customer_name: 'B',
        subject: 'Login issue',
        description: 'I need help with password reset for my account access.',
        category: Category.ACCOUNT_ACCESS,
        priority: 'high',
        status: 'new',
        tags: '[]',
      },
    });

    const res = await request(app).get('/tickets').query({ category: 'billing_question' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].category).toBe('billing_question');
  });

  it('GET /tickets with invalid query enum returns 400', async () => {
    const res = await request(app).get('/tickets').query({ category: 'not_a_real_category' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('GET /tickets with invalid sort still lists using default sort key', async () => {
    await request(app).post('/tickets').send({ ...validTicket, customer_id: 'sort_fallback' });
    const res = await request(app).get('/tickets').query({ sort: 'totally_not_sortable' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /tickets/:id returns ticket when found', async () => {
    const created = await request(app).post('/tickets').send(validTicket);
    const id = created.body.data.id as string;
    const res = await request(app).get(`/tickets/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('GET /tickets/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/tickets/nonexistent-id-12345');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('NOT_FOUND');
  });

  it('PUT /tickets/:id updates fields', async () => {
    const created = await request(app).post('/tickets').send(validTicket);
    const id = created.body.data.id as string;
    const before = created.body.data.updated_at;

    const res = await request(app)
      .put(`/tickets/${id}`)
      .send({ status: 'in_progress', assigned_to: 'agent_1' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');
    expect(res.body.data.assigned_to).toBe('agent_1');
    expect(res.body.data.updated_at).not.toBe(before);
  });

  it('PUT /tickets/:id with status resolved sets resolved_at', async () => {
    const created = await request(app).post('/tickets').send(validTicket);
    const id = created.body.data.id as string;
    const res = await request(app).put(`/tickets/${id}`).send({ status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('resolved');
    expect(res.body.data.resolved_at).not.toBeNull();
  });

  it('PUT /tickets/:id with status closed sets resolved_at when not provided', async () => {
    const created = await request(app).post('/tickets').send({
      ...validTicket,
      customer_id: 'closed_path',
    });
    const id = created.body.data.id as string;
    const res = await request(app).put(`/tickets/${id}`).send({ status: 'closed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
    expect(res.body.data.resolved_at).not.toBeNull();
  });

  it('GET /tickets/:id maps invalid tags JSON from DB to empty array', async () => {
    const row = await prisma.ticket.create({
      data: {
        customer_id: 'bad_tags_row',
        customer_email: 't@t.com',
        customer_name: 'T',
        subject: 'Subject line here',
        description: 'Description long enough for schema validation rules.',
        category: 'other',
        priority: 'medium',
        status: 'new',
        tags: 'not-valid-json',
      },
    });
    const res = await request(app).get(`/tickets/${row.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tags).toEqual([]);
  });

  it('DELETE /tickets/:id returns 204 and ticket is gone', async () => {
    const created = await request(app).post('/tickets').send(validTicket);
    const id = created.body.data.id as string;
    const del = await request(app).delete(`/tickets/${id}`);
    expect(del.status).toBe(204);
    const get = await request(app).get(`/tickets/${id}`);
    expect(get.status).toBe(404);
  });

  it('GET unknown path returns 404 from notFound handler', async () => {
    const res = await request(app).get('/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('NOT_FOUND');
  });

  it('POST /tickets/import without file returns 400', async () => {
    const res = await request(app).post('/tickets/import');
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain('File is required');
  });

  it('POST /tickets/import with unsupported type returns 415', async () => {
    const res = await request(app)
      .post('/tickets/import')
      .attach('file', Buffer.from('%PDF'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
  });

  it('POST /tickets/:id/auto-classify returns 409 when classification is overridden', async () => {
    const created = await request(app).post('/tickets').send({
      ...validTicket,
      customer_id: 'override_1',
    });
    const id = created.body.data.id as string;
    await request(app).put(`/tickets/${id}`).send({ classification_overridden: true }).expect(200);
    const res = await request(app).post(`/tickets/${id}/auto-classify`);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('CLASSIFICATION_OVERRIDDEN');
  });

  it('POST /tickets/:id/auto-classify?force=true succeeds after override', async () => {
    const created = await request(app).post('/tickets').send({
      ...validTicket,
      customer_id: 'override_2',
      subject: 'Invoice billing payment question',
      description: 'I need help understanding my latest invoice and charge.',
    });
    const id = created.body.data.id as string;
    await request(app).put(`/tickets/${id}`).send({ classification_overridden: true });
    const res = await request(app).post(`/tickets/${id}/auto-classify?force=true`);
    expect(res.status).toBe(200);
    expect(res.body.data.category).toBeDefined();
  });
});
