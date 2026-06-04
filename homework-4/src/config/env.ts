import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(10),
  AUTO_CLASSIFY_DEFAULT: z.coerce.boolean().default(false),
  // SECURITY: Set to specific origin(s) in production. Comma-separated list supported by app.ts if needed.
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  EXPOSE_STACK_TRACE: z.coerce.boolean().default(false),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
