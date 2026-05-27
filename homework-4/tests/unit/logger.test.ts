import { describe, it, expect, vi, afterEach } from 'vitest';

describe('logger redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('redacts PII fields in log output', async () => {
    vi.stubEnv('DATABASE_URL', 'file:./prisma/test.db');
    vi.stubEnv('LOG_LEVEL', 'info');

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const { logger } = await import('../../src/config/logger.js');
    logger.info(
      {
        ticket: {
          subject: 'secret subject line',
          description: 'private description text',
          customer_name: 'Alice Secret',
        },
      },
      'ticket event',
    );

    const output = writes.join('');
    expect(output).toContain('[Redacted]');
    expect(output).not.toContain('secret subject line');
    expect(output).not.toContain('private description text');
    expect(output).not.toContain('Alice Secret');
  });
});
