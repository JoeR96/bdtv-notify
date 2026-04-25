import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { readConfig } from '../services/config';
import { OllamaClient } from '../services/ollama-client';
import type { ExtractedTask } from '../types';

const TASK_PROMPT = `Extract all action items, tasks, and to-dos from the following note.
Return ONLY a JSON array of objects with this exact schema:
[{"title": "string", "priority": "high"|"medium"|"low"}]

Rules:
- Infer priority from urgency language ("urgent", "ASAP", "critical" → high; "soon", "next week" → medium; "eventually", "someday" → low)
- Default priority is "medium" if there is no urgency signal
- Return an empty array [] if there are no tasks
- Return ONLY the JSON array, no explanation, no markdown code block

---
{text}`;

const STRICT_TASK_PROMPT = `Extract tasks from the note below. Return a JSON array ONLY, no other text.
Format: [{"title":"task description","priority":"high"|"medium"|"low"}]
If no tasks, return: []

Note:
{text}`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function runExtractTasks(options: { file?: string; stdin?: boolean }): Promise<void> {
  const config = readConfig();
  const client = new OllamaClient(config.ollama.port, config.ollama.model);

  let content: string;

  if (options.stdin) {
    content = await readStdin();
  } else if (options.file) {
    const filePath = path.isAbsolute(options.file)
      ? options.file
      : path.join(config.obsidian.vault, options.file);

    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    content = fs.readFileSync(filePath, 'utf8');
  } else {
    console.error('Error: Provide --file or --stdin');
    process.exit(1);
  }

  const tryParse = (response: string): ExtractedTask[] | null => {
    const cleaned = response.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    try {
      const parsed = JSON.parse(cleaned) as ExtractedTask[];
      if (Array.isArray(parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  };

  let response = await client.generate(TASK_PROMPT.replace('{text}', content));
  let tasks = tryParse(response);

  if (tasks === null) {
    // Retry with stricter prompt
    response = await client.generate(STRICT_TASK_PROMPT.replace('{text}', content));
    tasks = tryParse(response) ?? [];
  }

  process.stdout.write(JSON.stringify(tasks, null, 2) + '\n');
}

export function registerExtractTasks(program: Command): void {
  program
    .command('extract-tasks')
    .description('Extract action items from a note as a JSON array')
    .option('--file <path>', 'Source note file (absolute or relative to vault)')
    .option('--stdin', 'Read note from stdin')
    .action(runExtractTasks);
}
