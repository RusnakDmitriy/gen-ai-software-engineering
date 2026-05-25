import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoMiddleware } from './config/logger.js';
import { env } from './config/env.js';
import { ticketRoutes } from './api/routes/tickets.routes.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { notFound } from './api/middleware/notFound.js';

export function createApp() {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));

  if (env.NODE_ENV !== 'test') {
    app.use(
      rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.RATE_LIMIT_MAX,
        message: 'Too many requests from this IP, please try again later.',
      }),
    );
  }

  // Logging middleware
  app.use(pinoMiddleware);

  // Body parser
  app.use(express.json({ limit: '1mb' }));

  // Routes
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/tickets', ticketRoutes);

  // 404 and error handlers — must be last
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
