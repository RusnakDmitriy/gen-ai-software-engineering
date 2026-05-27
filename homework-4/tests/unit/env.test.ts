import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

describe('env configuration', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('defaults CORS_ORIGIN to http://localhost:3000', async () => {
    vi.stubEnv('DATABASE_URL', 'file:./prisma/test.db');

    const { env } = await import('../../src/config/env.js');
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
  });

  it('defaults EXPOSE_STACK_TRACE to false', async () => {
    vi.stubEnv('DATABASE_URL', 'file:./prisma/test.db');

    const { env } = await import('../../src/config/env.js');
    expect(env.EXPOSE_STACK_TRACE).toBe(false);
  });
});
