import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { readConfig, getConfigDir } from '../services/config';
import { OllamaClient } from '../services/ollama-client';
import type { TidyMode } from '../types';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function loadPromptTemplate(mode: TidyMode, config: ReturnType<typeof readConfig>): string {
  const overridePath = mode === 'light' ? config.prompts.light : config.prompts.deep;
  if (overridePath && fs.existsSync(overridePath)) {
    return fs.readFileSync(overridePath, 'utf8');
  }

  const conventionPath = path.join(getConfigDir(), 'prompts', `${mode}-tidy.md`);
  if (fs.existsSync(conventionPath)) {
    return fs.readFileSync(conventionPath, 'utf8');
  }

  const bundledPath = path.join(__dirname, '..', 'prompts', `${mode}-tidy.md`);
  return fs.readFileSync(bundledPath, 'utf8');
}

async function tidyContent(
  content: string,
  mode: TidyMode,
  config: ReturnType<typeof readConfig>
): Promise<string> {
  const client = new OllamaClient(config.ollama.port, config.ollama.model);
  const template = loadPromptTemplate(mode, config);
  const prompt = template.replace('{text}', content);
  return client.generate(prompt);
}

async function tidyFile(
  filePath: string,
  mode: TidyMode,
  dryRun: boolean,
  config: ReturnType<typeof readConfig>
): Promise<void> {
  const content = fs.readFileSync(filePath, 'utf8');
  const start = performance.now();
  const result = await tidyContent(content, mode, config);
  const duration = (performance.now() - start) / 1000;

  if (dryRun) {
    console.log(result);
  } else {
    fs.writeFileSync(filePath, result, 'utf8');
    console.error(`[tidy] ${mode} ${filePath} (${duration.toFixed(1)}s)`);
  }
}

async function runTidy(options: {
  file?: string;
  stdin?: boolean;
  deep?: boolean;
  dryRun?: boolean;
  folder?: string;
}): Promise<void> {
  const config = readConfig();
  const mode: TidyMode = options.deep ? 'deep' : 'light';

  if (options.stdin) {
    const content = await readStdin();
    const result = await tidyContent(content, mode, config);
    process.stdout.write(result + '\n');
    return;
  }

  if (options.folder) {
    const vaultPath = config.obsidian.vault;
    const folderPath = options.folder.startsWith('/') || /^[A-Za-z]:/.test(options.folder)
      ? options.folder
      : path.join(vaultPath, options.folder);

    if (!fs.existsSync(folderPath)) {
      console.error(`Error: Folder not found: ${folderPath}`);
      process.exit(1);
    }

    const files = fs.readdirSync(folderPath)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(folderPath, f));

    if (files.length === 0) {
      console.error('No .md files found in folder.');
      return;
    }

    for (const file of files) {
      await tidyFile(file, mode, options.dryRun ?? false, config);
    }
    return;
  }

  if (options.file) {
    const vaultPath = config.obsidian.vault;
    const filePath = path.isAbsolute(options.file)
      ? options.file
      : path.join(vaultPath, options.file);

    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    await tidyFile(filePath, mode, options.dryRun ?? false, config);
    return;
  }

  console.error('Error: Provide --file, --folder, or --stdin');
  process.exit(1);
}

export function registerTidy(program: Command): void {
  program
    .command('tidy')
    .description('Tidy a note via the local Ollama LLM')
    .option('--file <path>', 'Note file to tidy (absolute or relative to vault)')
    .option('--stdin', 'Read note text from stdin')
    .option('--deep', 'Use deep-tidy mode (restructure, add headings, extract action items)')
    .option('--dry-run', 'Print result to stdout without writing back')
    .option('--folder <dir>', 'Tidy all .md files in this folder (relative to vault or absolute)')
    .action(runTidy);
}
