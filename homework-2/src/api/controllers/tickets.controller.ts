import { Request, Response, NextFunction } from 'express';
import { ticketsService } from '../../services/tickets.service.js';
import { importService } from '../../services/import.service.js';
import { NotFoundError } from '../../domain/errors.js';
import { buildPaginationMeta } from '../../utils/pagination.js';
import type { TicketQuery } from '../../domain/ticket.schema.js';

export async function createTicket(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const autoClassify = req.query.auto_classify === 'true';
  const ticket = await ticketsService.create(req.body, { autoClassify });
  res.status(201).json({ data: ticket });
}

export async function listTickets(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const query = req.query as unknown as TicketQuery;
  const { data, total } = await ticketsService.list(query);
  res.json({
    data,
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  });
}

export async function getTicket(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const id = req.params.id as string;
  if (!id) {
    throw new NotFoundError('Ticket', 'unknown');
  }
  const ticket = await ticketsService.findById(id);
  if (!ticket) {
    throw new NotFoundError('Ticket', id);
  }
  res.json({ data: ticket });
}

export async function updateTicket(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const id = req.params.id as string;
  if (!id) {
    throw new NotFoundError('Ticket', 'unknown');
  }
  const ticket = await ticketsService.update(id, req.body);
  res.json({ data: ticket });
}

export async function deleteTicket(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const id = req.params.id as string;
  if (!id) {
    throw new NotFoundError('Ticket', 'unknown');
  }
  await ticketsService.delete(id);
  res.status(204).send();
}

export async function bulkImport(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  if (!req.file) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'File is required' },
    });
    return;
  }

  const autoClassify = req.query.auto_classify === 'true';
  const result = await importService.importFile(
    req.file.buffer,
    req.file.mimetype,
    req.file.originalname,
    { autoClassify },
  );

  res.status(201).json({ data: result });
}

export async function autoClassify(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const force = req.query.force === 'true';
  const idParam = req.params.id;
  if (!idParam) {
    throw new NotFoundError('Ticket', 'unknown');
  }
  const result = await ticketsService.autoClassify(idParam, { force });
  res.json({ data: result });
}
