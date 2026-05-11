import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ensure the SQLite schema exists for integration tests before workers start.
 */
export default function globalSetup(): void {
  const databaseUrl = process.env.DATABASE_URL ?? 'file:./prisma/test.db';
  execSync('npx prisma db push --skip-generate', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
  });
}
