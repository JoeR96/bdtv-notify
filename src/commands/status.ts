import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { Command } from 'commander';
import { readConfig } from '../services/config';

async function httpCheck(url: string, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function checkDockerDaemon(): { ok: boolean; version: string } {
  try {
    const out = execSync('docker version --format "{{.Server.Version}}"', {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return { ok: true, version: out };
  } catch {
    return { ok: false, version: '' };
  }
}

function statusLine(label: string, ok: boolean, detail: string): string {
  const icon = ok ? '✅' : '❌';
  return `  ${icon}  ${label.padEnd(12)} ${detail}`;
}

async function runStatus(): Promise<void> {
  const config = readConfig();

  console.log('\nbdtv-note-orc status\n');

  // Run all checks concurrently
  const [dockerResult, whisperOk, ollamaOk, tidyApiOk] = await Promise.all([
    Promise.resolve(checkDockerDaemon()),
    httpCheck(`http://127.0.0.1:${config.whisper.port}/health`),
    httpCheck(`http://127.0.0.1:${config.ollama.port}/api/tags`),
    httpCheck(`http://127.0.0.1:${config.api.port}/health`),
  ]);

  const vaultOk = config.obsidian.vault !== '' && fs.existsSync(config.obsidian.vault);

  console.log(
    statusLine(
      'Docker',
      dockerResult.ok,
      dockerResult.ok ? `running (v${dockerResult.version})` : 'not running'
    )
  );
  console.log(
    statusLine(
      'Whisper',
      whisperOk,
      whisperOk
        ? `running (${config.whisper.model}) at localhost:${config.whisper.port}`
        : `stopped (port ${config.whisper.port})`
    )
  );
  console.log(
    statusLine(
      'Ollama',
      ollamaOk,
      ollamaOk
        ? `running (${config.ollama.model}) at localhost:${config.ollama.port}`
        : `stopped (port ${config.ollama.port})`
    )
  );
  console.log(
    statusLine(
      'Tidy API',
      tidyApiOk,
      tidyApiOk ? `running at localhost:${config.api.port}` : `stopped (port ${config.api.port})`
    )
  );
  console.log(
    statusLine(
      'Vault',
      vaultOk,
      vaultOk ? config.obsidian.vault : config.obsidian.vault ? 'path not found' : 'not configured (run olt setup)'
    )
  );

  if (config.gpu.detected) {
    console.log(`\n  GPU: ${config.gpu.device} (${config.gpu.type})`);
  } else {
    console.log('\n  GPU: none (CPU-only mode)');
  }

  console.log('');
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show health of all services')
    .action(runStatus);
}
