#!/usr/bin/env tsx
/**
 * Runs the 5-agent bug-fix pipeline in order via the Cursor Agent CLI.
 *
 * Prerequisites:
 *   - Cursor Agent CLI: curl https://cursor.com/install -fsS | bash
 *   - Auth: export CURSOR_API_KEY=...  OR  agent login
 *
 * Usage:
 *   npm run pipeline
 *   npm run pipeline -- --dry-run
 *   npm run pipeline -- --from 3
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAgentFile } from './lib/parse-agent-frontmatter.js';
import {
  PIPELINE_AGENT_FILES,
  PIPELINE_PREREQUISITE,
  agentPath,
} from './lib/pipeline-stages.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface CliOptions {
  dryRun: boolean;
  fromStage: number;
  listModels: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let fromStage = 1;
  let listModels = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--list-models') listModels = true;
    else if (arg === '--from' && argv[i + 1]) {
      fromStage = Number.parseInt(argv[++i], 10);
      if (Number.isNaN(fromStage) || fromStage < 1 || fromStage > 5) {
        console.error('--from must be a number between 1 and 5');
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return { dryRun, fromStage, listModels };
}

function printHelp(): void {
  console.log(`
Bug-fix agent pipeline (5 stages)

  npm run pipeline
  npm run pipeline -- --dry-run          # validate config, print prompts only
  npm run pipeline -- --from 3           # resume from stage 3 (bug-fixer)
  npm run pipeline -- --list-models      # run: agent models

Prerequisites:
  1. Install Cursor Agent CLI:
       curl https://cursor.com/install -fsS | bash
  2. Authenticate:
       export CURSOR_API_KEY=your_key
     or:
       agent login

Stages (in order):
  1. Bug Research Verifier  → research/verified-research.md
  2. Bug Planner            → research/implementation-plan.md
  3. Bug Fixer              → research/fix-summary.md (+ code changes)
  4. Security Verifier      → research/security-report.md
  5. Unit Test Generator    → research/test-report.md (+ tests)
`);
}

function resolveAgentBinary(): string {
  const candidates = [
    process.env.CURSOR_AGENT_BIN,
    'agent',
    'cursor-agent',
    join(homedir(), '.local', 'bin', 'agent'),
    join(homedir(), '.cursor', 'bin', 'agent'),
  ].filter((c): c is string => Boolean(c));

  for (const bin of candidates) {
    if (bin.includes('/') && existsSync(bin)) return bin;
  }

  return 'agent';
}

function fileExists(relPath: string): boolean {
  return existsSync(join(ROOT, relPath));
}

function loadSkillContent(skillRelPath: string): string {
  const full = join(ROOT, skillRelPath);
  if (!existsSync(full)) {
    throw new Error(`Skill file not found: ${skillRelPath}`);
  }
  return readFileSync(full, 'utf8');
}

function buildPrompt(
  stageNum: number,
  total: number,
  agentBody: string,
  frontmatter: ReturnType<typeof parseAgentFile>['frontmatter'],
  priorOutputs: string[],
): string {
  const skillBlocks = frontmatter.skills
    .map((p) => {
      const content = loadSkillContent(p);
      return `### Skill: ${p}\n\n${content}`;
    })
    .join('\n\n---\n\n');

  const priorSection =
    priorOutputs.length > 0
      ? priorOutputs
          .map((p) => `- \`${p}\` (${fileExists(p) ? 'exists' : 'MISSING — create in this stage'})`)
          .join('\n')
      : '- (none — first stage)';

  const outputSection = frontmatter.outputs
    .filter((o) => !o.includes('**') && !o.includes('Modified'))
    .map((o) => `- \`${o}\``)
    .join('\n');

  return [
    `# Pipeline execution — Stage ${stageNum} of ${total}`,
    '',
    `You are **${frontmatter.name}** (stage ${stageNum}/${total}).`,
    'Follow the agent instructions and any skills below exactly.',
    'Work in the homework-4 workspace root. Do not skip required output files.',
    '',
    '## Prior pipeline artifacts',
    priorSection,
    '',
    '## Required outputs for this stage',
    outputSection,
    '',
    skillBlocks ? '## Skills (mandatory)\n\n' + skillBlocks + '\n' : '',
    '## Agent instructions',
    '',
    agentBody,
  ].join('\n');
}

function runAgentCli(
  binary: string,
  model: string,
  prompt: string,
  dryRun: boolean,
): Promise<number> {
  const args = [
    '-p',
    '--force',
    '--trust',
    '--workspace',
    ROOT,
    '--model',
    model,
    '--output-format',
    'text',
    prompt,
  ];

  if (dryRun) {
    console.log('\n--- Would run ---');
    console.log(`${binary} ${args.slice(0, -1).join(' ')} "<prompt ${prompt.length} chars>"`);
    return Promise.resolve(0);
  }

  return new Promise((resolve, reject) => {
    console.log(`\n▶ Invoking: ${binary} -p --model ${model} ...\n`);

    const child = spawn(binary, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `Cursor Agent CLI not found (${binary}). Install:\n  curl https://cursor.com/install -fsS | bash\nThen authenticate: export CURSOR_API_KEY=... or agent login`,
          ),
        );
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => resolve(code ?? 1));
  });
}

function validateOutputs(outputs: string[], stageName: string): void {
  const missing = outputs.filter(
    (o) => !o.includes('**') && !o.includes('Modified') && !fileExists(o),
  );
  if (missing.length > 0) {
    throw new Error(
      `Stage "${stageName}" did not produce required outputs:\n  ${missing.join('\n  ')}`,
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (!fileExists(PIPELINE_PREREQUISITE)) {
    console.error(`Missing prerequisite: ${PIPELINE_PREREQUISITE}`);
    console.error('Run the Bug Researcher first or add codebase research.');
    process.exit(1);
  }

  const binary = resolveAgentBinary();

  if (opts.listModels) {
    if (opts.dryRun) {
      console.log(`Would run: ${binary} models`);
      return;
    }
    const code = await new Promise<number>((resolve) => {
      const child = spawn(binary, ['models'], { cwd: ROOT, stdio: 'inherit' });
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', () => {
        console.error('Install Cursor Agent CLI first.');
        resolve(1);
      });
    });
    process.exit(code);
  }

  console.log('═'.repeat(60));
  console.log('  Homework-4 — 5-Agent Bug-Fix Pipeline');
  console.log('═'.repeat(60));
  console.log(`Workspace: ${ROOT}`);
  console.log(`Agent CLI: ${binary}`);
  if (opts.dryRun) console.log('Mode: DRY RUN (no agent invocations)\n');

  const stages = PIPELINE_AGENT_FILES.map((file) => {
    const path = agentPath(ROOT, file);
    const { frontmatter, body } = parseAgentFile(path);
    return { file, path, frontmatter, body };
  }).sort((a, b) => a.frontmatter.stage - b.frontmatter.stage);

  const artifactTrail: string[] = [PIPELINE_PREREQUISITE];

  for (const stage of stages) {
    const { frontmatter, body, file } = stage;
    if (frontmatter.stage < opts.fromStage) {
      console.log(`\n⏭ Skipping stage ${frontmatter.stage} (${frontmatter.name}) — --from ${opts.fromStage}`);
      for (const o of frontmatter.outputs) {
        if (!o.includes('**') && !o.includes('Modified')) artifactTrail.push(o);
      }
      continue;
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`  Stage ${frontmatter.stage}/5 — ${frontmatter.name}`);
    console.log(`  Model: ${frontmatter.model}`);
    console.log(`  Agent: agents/${file}`);
    if (frontmatter.skills.length) {
      console.log(`  Skills: ${frontmatter.skills.join(', ')}`);
    }
    console.log('─'.repeat(60));

    const prompt = buildPrompt(
      frontmatter.stage,
      stages.length,
      body,
      frontmatter,
      artifactTrail.filter((p) => p !== PIPELINE_PREREQUISITE || frontmatter.stage === 1),
    );

    const exitCode = await runAgentCli(binary, frontmatter.model, prompt, opts.dryRun);
    if (exitCode !== 0 && !opts.dryRun) {
      console.error(`\n✗ Stage ${frontmatter.stage} (${frontmatter.name}) exited with code ${exitCode}`);
      process.exit(exitCode);
    }

    if (!opts.dryRun) {
      try {
        validateOutputs(frontmatter.outputs, frontmatter.name);
        console.log(`\n✓ Stage ${frontmatter.stage} outputs verified`);
      } catch (err) {
        console.error(`\n✗ ${(err as Error).message}`);
        console.error('Fix outputs manually or re-run with --from', frontmatter.stage);
        process.exit(1);
      }
    }

    for (const o of frontmatter.outputs) {
      if (!o.includes('**') && !o.includes('Modified')) artifactTrail.push(o);
    }
  }

  console.log('\n' + '═'.repeat(60));
  if (opts.dryRun) {
    console.log('  Dry run complete — no agents were invoked.');
  } else {
    console.log('  Pipeline complete.');
    console.log('\nArtifacts:');
    for (const p of artifactTrail) {
      if (p !== PIPELINE_PREREQUISITE || fileExists(p)) {
        console.log(`  • ${p}`);
      }
    }
  }
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
