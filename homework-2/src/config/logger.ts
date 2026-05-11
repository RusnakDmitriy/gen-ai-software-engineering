import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'http';
import { env } from './env.js';

function serializeReq(req: IncomingMessage) {
  const withId = req as IncomingMessage & { id?: unknown };
  return {
    method: req.method,
    url: req.url,
    id: withId.id,
    ip: req.socket?.remoteAddress,
  };
}

const pinoInstance = pino({
  level: env.LOG_LEVEL,
  serializers: {
    req: serializeReq,
    res: (res: ServerResponse) => ({
      statusCode: res.statusCode,
    }),
  },
  redact: ['*.customer_email', '*.email', '*.password', 'authorization'],
});

export const logger = pinoInstance;

export const pinoMiddleware = pinoHttp({ logger: pinoInstance });
