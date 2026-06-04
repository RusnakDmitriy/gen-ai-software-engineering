import { join } from 'node:path';

/** Ordered pipeline stages (matches agents/*.agent.md stage numbers). */
export const PIPELINE_AGENT_FILES = [
  'research-verifier.agent.md',
  'planner.agent.md',
  'bug-fixer.agent.md',
  'security-verifier.agent.md',
  'unit-test-generator.agent.md',
] as const;

/** Required research input before stage 1. */
export const PIPELINE_PREREQUISITE = 'research/codebase-research.md';

export function agentsDir(root: string): string {
  return join(root, 'agents');
}

export function agentPath(root: string, filename: string): string {
  return join(agentsDir(root), filename);
}
