import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { upload } from '../middleware/upload.js';
import {
  createTicket,
  listTickets,
  getTicket,
  updateTicket,
  deleteTicket,
  bulkImport,
  autoClassify,
} from '../controllers/tickets.controller.js';
import { TicketCreateSchema, TicketUpdateSchema, TicketQuerySchema } from '../../domain/ticket.schema.js';

export const ticketRoutes = Router();

ticketRoutes.post('/', validate(TicketCreateSchema), asyncHandler(createTicket));
ticketRoutes.get('/', validate(TicketQuerySchema, 'query'), asyncHandler(listTickets));
ticketRoutes.get('/:id', asyncHandler(getTicket));
ticketRoutes.put('/:id', validate(TicketUpdateSchema), asyncHandler(updateTicket));
ticketRoutes.delete('/:id', asyncHandler(deleteTicket));
ticketRoutes.post('/import', upload.single('file'), asyncHandler(bulkImport));
ticketRoutes.post('/:id/auto-classify', asyncHandler(autoClassify));
