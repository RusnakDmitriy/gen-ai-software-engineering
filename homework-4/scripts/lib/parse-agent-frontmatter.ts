import { readFileSync } from 'node:fs';

export interface AgentFrontmatter {
  name: string;
  model: string;
  stage: number;
  skills: string[];
  outputs: string[];
  inputs: string[];
}

function parseYamlList(block: string): string[] {
  const items: string[] = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*-\s+(.+)$/);
    if (m) {
      let value = m[1].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      items.push(value);
    }
  }
  return items;
}

function parseScalar(key: string, yaml: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const m = yaml.match(re);
  if (!m) return undefined;
  let value = m[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  if (value === '>' || value === '|') return undefined;
  return value;
}

function parseBlockList(key: string, yaml: string): string[] {
  const re = new RegExp(`^${key}:\\s*$`, 'm');
  const inline = new RegExp(`^${key}:\\s*\\[\\s*\\]\\s*$`, 'm');
  if (inline.test(yaml)) return [];
  const m = yaml.match(re);
  if (!m || m.index === undefined) return [];
  const start = m.index + m[0].length;
  const rest = yaml.slice(start);
  const lines = rest.split('\n');
  const block: string[] = [];
  for (const line of lines) {
    if (/^\S/.test(line) && line.trim() !== '') break;
    if (/^\s*-\s+/.test(line)) block.push(line);
    else if (line.trim() === '') continue;
    else if (block.length > 0) break;
  }
  return parseYamlList(block.join('\n'));
}

export function parseAgentFile(filePath: string): {
  frontmatter: AgentFrontmatter;
  body: string;
} {
  const raw = readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid agent file (missing frontmatter): ${filePath}`);
  }
  const yaml = match[1];
  const body = match[2].trim();

  const name = parseScalar('name', yaml);
  const model = parseScalar('model', yaml);
  const stageStr = parseScalar('stage', yaml);
  if (!name || !model || !stageStr) {
    throw new Error(`Agent file missing name, model, or stage: ${filePath}`);
  }

  return {
    frontmatter: {
      name,
      model,
      stage: Number.parseInt(stageStr, 10),
      skills: parseBlockList('skills', yaml),
      outputs: parseBlockList('outputs', yaml),
      inputs: parseBlockList('inputs', yaml),
    },
    body,
  };
}
