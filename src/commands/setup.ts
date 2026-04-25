import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import {
  intro,
  outro,
  select,
  text,
  confirm,
  spinner,
  note,
  cancel,
  isCancel,
  log,
} from '@clack/prompts';
import { configureObsidianPlugins } from './obsidian-setup';
import { detectGpu } from '../services/gpu-detect';
import { writeConfig, readConfig } from '../services/config';
import type { AppConfig } from '../types';
import defaults from '../../config/defaults.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkCancel(value: unknown): void {
  if (isCancel(value)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }
}

function run(cmd: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, status: code ?? 1 }));
    child.on('error', (err) => resolve({ stdout, stderr: err.message, status: 1 }));
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Setup steps
// ---------------------------------------------------------------------------

async function checkDocker(): Promise<void> {
  const s = spinner();
  s.start('Checking Docker');
  const result = await run('docker', ['info']);
  if (result.status !== 0) {
    s.error('Docker is not running');
    cancel('Start Docker Desktop and run olt setup again.');
    process.exit(1);
  }
  s.stop('Docker is running');
}

async function pullDockerImage(image: string): Promise<void> {
  const s = spinner();
  s.start(`Pulling ${image}`);
  const result = await run('docker', ['pull', image]);
  if (result.status !== 0) {
    s.error(`Failed to pull ${image}`);
    cancel(result.stderr.trim() || 'Docker pull failed.');
    process.exit(1);
  }
  s.stop(`${image} ready`);
}

async function downloadWhisperModel(modelName: string, url: string): Promise<void> {
  const s = spinner();
  const entry = (defaults.whisperModels as Array<{ name: string; sizeMb: number; url: string }>)
    .find((m) => m.name === modelName);
  s.start(`Downloading ${modelName}${entry ? ` (${entry.sizeMb} MB)` : ''}`);
  const result = await run('docker', [
    'run', '--rm',
    '-v', 'bdtv-note-orc_whisper-models:/models',
    'alpine/curl',
    'curl', '-L', '-s',
    '-o', `/models/${modelName}.bin`,
    url,
  ]);
  if (result.status !== 0) {
    s.error(`Failed to download ${modelName}`);
    cancel(result.stderr.trim() || 'Download failed.');
    process.exit(1);
  }
  s.stop(`${modelName} downloaded`);
}

async function pullOllamaModel(modelName: string): Promise<void> {
  const containerName = 'olt-setup-ollama';
  const s = spinner();

  // Clean up any leftover container from a previous failed run
  await run('docker', ['rm', '-f', containerName]);

  s.start('Starting temporary Ollama container');
  const startResult = await run('docker', [
    'run', '-d', '--rm',
    '--name', containerName,
    '-v', 'bdtv-note-orc_ollama-models:/root/.ollama',
    'ollama/ollama',
  ]);

  if (startResult.status !== 0) {
    s.error('Failed to start Ollama container');
    cancel(startResult.stderr.trim());
    process.exit(1);
  }

  // Poll until the server is ready
  s.message('Waiting for Ollama to be ready');
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const check = await run('docker', ['exec', containerName, 'ollama', 'list']);
    if (check.status === 0) { ready = true; break; }
  }

  if (!ready) {
    await run('docker', ['rm', '-f', containerName]);
    s.error('Ollama did not become ready in time');
    cancel('Try running olt setup again.');
    process.exit(1);
  }

  // Stream docker exec output to show download percentage on the spinner
  s.message(`Pulling ${modelName} — 0%`);
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn('docker', ['exec', containerName, 'ollama', 'pull', modelName], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onChunk = (data: Buffer): void => {
      // Ollama outputs progress with \r between updates; extract the latest %
      const text = data.toString().replace(/\r/g, '\n');
      const matches = [...text.matchAll(/(\d+)%/g)];
      if (matches.length > 0) {
        const pct = matches[matches.length - 1][1];
        s.message(`Pulling ${modelName} — ${pct}%`);
      }
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  await run('docker', ['stop', containerName]);

  if (exitCode !== 0) {
    s.error(`Failed to pull ${modelName}`);
    cancel('Ollama pull failed. Run olt setup again to retry.');
    process.exit(1);
  }

  s.stop(`${modelName} ready`);
}

function findObsidianVaultFromConfig(): string[] {
  try {
    const obsidianConfigPath =
      process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming', 'Obsidian', 'obsidian.json')
        : path.join(os.homedir(), '.config', 'obsidian', 'obsidian.json');

    if (fs.existsSync(obsidianConfigPath)) {
      const raw = fs.readFileSync(obsidianConfigPath, 'utf8');
      const data = JSON.parse(raw) as { vaults?: Record<string, { path: string }> };
      if (data.vaults) {
        return Object.values(data.vaults)
          .filter((v) => v.path && fs.existsSync(path.join(v.path, '.obsidian')))
          .map((v) => v.path);
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function hotkeyCommands(apiPort: number): string {
  const url = `http://localhost:${apiPort}/tidy`;
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    return [
      'Shell to use in Shell Commands settings: cmd.exe',
      '',
      'Light tidy:',
      `  curl.exe -s -X POST ${url} -H "Content-Type: application/json" -d "{\\"file\\": \\"{{file_path:relative}}\\", \\"mode\\": \\"light\\"}"`,
      '',
      'Deep tidy:',
      `  curl.exe -s -X POST ${url} -H "Content-Type: application/json" -d "{\\"file\\": \\"{{file_path:relative}}\\", \\"mode\\": \\"deep\\"}"`,
    ].join('\n');
  }

  return [
    'Light tidy:',
    `  curl -s -X POST ${url} -H "Content-Type: application/json" -d '{"file": "{{file_path:relative}}", "mode": "light"}'`,
    '',
    'Deep tidy:',
    `  curl -s -X POST ${url} -H "Content-Type: application/json" -d '{"file": "{{file_path:relative}}", "mode": "deep"}'`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

async function runSetup(options: {
  whisperModel?: string;
  ollamaModel?: string;
  showHotkeys?: boolean;
}): Promise<void> {
  const config = readConfig();

  if (options.showHotkeys) {
    note(hotkeyCommands(config.api.port), 'Obsidian hotkey setup');
    return;
  }

  intro('bdtv-note-orc setup');

  // 1. Docker check
  await checkDocker();

  // 2. GPU detection
  const gpu = detectGpu();
  if (gpu.type === 'nvidia') {
    log.success(`GPU: ${gpu.device} (NVIDIA — GPU acceleration enabled)`);
  } else if (gpu.type === 'apple-silicon') {
    log.info('GPU: Apple Silicon (Ollama uses Metal natively; Whisper runs CPU in Docker)');
  } else {
    log.warn('GPU: none detected — running CPU-only (transcription will be slower)');
  }

  // 3. Select Whisper model
  let whisperModelName = options.whisperModel;
  if (!whisperModelName) {
    const choice = await select({
      message: 'Select a Whisper model',
      options: (defaults.whisperModels as Array<{ name: string; sizeMb: number; url: string }>).map((m) => ({
        value: m.name,
        label: m.name,
        hint: `${m.sizeMb} MB${m.name === defaults.whisper.model ? ' · recommended' : ''}`,
      })),
      initialValue: defaults.whisper.model,
    });
    checkCancel(choice);
    whisperModelName = choice as string;
  }

  const whisperEntry = (defaults.whisperModels as Array<{ name: string; sizeMb: number; url: string }>)
    .find((m) => m.name === whisperModelName)!;

  // 4. Select Ollama model
  let ollamaModelName = options.ollamaModel;
  if (!ollamaModelName) {
    const choice = await select({
      message: 'Select an Ollama language model',
      options: (defaults.ollamaModels as Array<{ name: string; description: string }>).map((m) => ({
        value: m.name,
        label: m.name,
        hint: `${m.description}${m.name === defaults.ollama.model ? ' · recommended' : ''}`,
      })),
      initialValue: defaults.ollama.model,
    });
    checkCancel(choice);
    ollamaModelName = choice as string;
  }

  // 5. Detect Obsidian vault
  const detectedVaults = findObsidianVaultFromConfig();
  const defaultVault = path.join(os.homedir(), 'Documents', 'Obsidian Vault');
  if (fs.existsSync(path.join(defaultVault, '.obsidian')) && !detectedVaults.includes(defaultVault)) {
    detectedVaults.unshift(defaultVault);
  }

  let vaultPath: string;
  if (detectedVaults.length > 0) {
    const vaultOptions = [
      ...detectedVaults.map((v) => ({ value: v, label: v })),
      { value: '__custom__', label: 'Enter a different path' },
    ];
    const choice = await select({
      message: 'Select your Obsidian vault',
      options: vaultOptions,
      initialValue: detectedVaults[0],
    });
    checkCancel(choice);

    if (choice === '__custom__') {
      const entered = await text({
        message: 'Enter the path to your Obsidian vault',
        validate: (v) => {
          if (!v?.trim()) return 'Path is required';
          if (!fs.existsSync(path.join(v.trim(), '.obsidian'))) return 'No .obsidian directory found at that path';
        },
      });
      checkCancel(entered);
      vaultPath = (entered as string).trim();
    } else {
      vaultPath = choice as string;
    }
  } else {
    const entered = await text({
      message: 'Enter the path to your Obsidian vault',
      placeholder: path.join(os.homedir(), 'Documents', 'Obsidian Vault'),
      validate: (v) => {
        if (!v?.trim()) return 'Path is required';
        if (!fs.existsSync(path.join(v.trim(), '.obsidian'))) return 'No .obsidian directory found at that path';
      },
    });
    checkCancel(entered);
    vaultPath = (entered as string).trim();
  }

  // 6. Confirm before downloading
  const confirmed = await confirm({
    message: [
      `Whisper model: ${whisperModelName} (${whisperEntry.sizeMb} MB)`,
      `Ollama model:  ${ollamaModelName}`,
      `Vault:         ${vaultPath}`,
      '',
      'Pull Docker images and download models now?',
    ].join('\n'),
  });
  checkCancel(confirmed);
  if (!confirmed) {
    cancel('Setup cancelled.');
    process.exit(0);
  }

  // 7. Pull Docker images
  await pullDockerImage('ghcr.io/ggml-org/whisper.cpp:main');
  await pullDockerImage('ollama/ollama:latest');

  // 8. Download Whisper model
  await downloadWhisperModel(whisperEntry.name, whisperEntry.url);

  // 9. Pull Ollama model
  await pullOllamaModel(ollamaModelName);

  // 10. Write config
  const newConfig: AppConfig = {
    whisper: { model: whisperEntry.name, port: defaults.whisper.port },
    ollama: { model: ollamaModelName, port: defaults.ollama.port },
    api: { port: defaults.api.port },
    gpu,
    obsidian: { vault: vaultPath },
    prompts: { light: null, deep: null },
  };
  writeConfig(newConfig);
  log.success('Config saved');

  // 11. Configure Obsidian plugins
  const pluginsDir = path.join(vaultPath, '.obsidian', 'plugins');
  const whisperInstalled = fs.existsSync(path.join(pluginsDir, 'whisper'));
  const scInstalled      = fs.existsSync(path.join(pluginsDir, 'obsidian-shellcommands'));
  const bothInstalled    = whisperInstalled && scInstalled;

  if (bothInstalled) {
    const s = spinner();
    s.start('Configuring Obsidian plugins');
    const result = configureObsidianPlugins(newConfig);
    s.stop('Obsidian plugins configured');
    if (result.whisper === 'configured')       log.success('Whisper → server URL set');
    if (result.shellCommands === 'configured') log.success('Shell Commands → tidy commands written');
    log.success('Hotkeys written  (Ctrl+Shift+T = light tidy,  Ctrl+Shift+D = deep tidy)');
    note('Restart Obsidian to apply the plugin changes.', 'Almost there');
  } else {
    const missing: string[] = [];
    if (!whisperInstalled)  missing.push('Whisper (by Nik Danilov)');
    if (!scInstalled)       missing.push('Shell Commands (by Jarkko Linnanvirta)');
    note(
      [
        'Install the following plugin(s) from Obsidian',
        'Community plugins browser, then run:',
        '',
        '  olt obsidian-setup',
        '',
        'Missing:',
        ...missing.map((m) => `  • ${m}`),
      ].join('\n'),
      'Obsidian plugins needed'
    );
  }

  outro(bothInstalled
    ? 'All done! Restart Obsidian, then run  olt serve  to start.'
    : 'Setup complete. Install the plugins, run  olt obsidian-setup, then  olt serve.'
  );
  process.exit(0);
}

export function registerSetup(program: Command): void {
  program
    .command('setup')
    .description('Interactive wizard: pull Docker images, download models, configure vault')
    .option('--whisper-model <model>', 'Whisper model (skip prompt)')
    .option('--ollama-model <model>', 'Ollama model (skip prompt)')
    .option('--show-hotkeys', 'Print Obsidian Shell Commands hotkey setup and exit')
    .action(runSetup);
}
