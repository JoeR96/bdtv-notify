import type { Command } from 'commander';
import { readConfig, updateConfig } from '../services/config';
import { ModelManager } from '../services/model-manager';
import defaults from '../../config/defaults.json';

async function runModelsList(): Promise<void> {
  const config = readConfig();
  const manager = new ModelManager(config.ollama.port, config.ollama.model);

  const installedWhisper = manager.listInstalledWhisperModels();
  const installedOllama = await manager.listInstalledOllamaModels().catch(() => [] as string[]);

  console.log(`\nWhisper Models (current: ${config.whisper.model})`);
  for (const m of defaults.whisperModels) {
    const isCurrent = m.name === config.whisper.model;
    const installed = installedWhisper.includes(m.name) ? '[installed]' : '[not downloaded]';
    const marker = isCurrent ? '  *' : '   ';
    console.log(`${marker} ${m.name.padEnd(22)} ${String(m.sizeMb).padStart(5)} MB   ${installed}`);
  }

  console.log(`\nOllama Models (current: ${config.ollama.model})`);
  for (const m of defaults.ollamaModels) {
    const isCurrent = m.name === config.ollama.model;
    const installed = installedOllama.includes(m.name) ? '[installed]' : '[not pulled]';
    const marker = isCurrent ? '  *' : '   ';
    console.log(`${marker} ${m.name.padEnd(22)} ${installed}   ${m.description}`);
  }

  console.log('');
}

async function runUseLlm(modelName: string): Promise<void> {
  const config = readConfig();
  const known = defaults.ollamaModels.map((m) => m.name);

  if (!known.includes(modelName)) {
    console.error(`Error: Unknown Ollama model: ${modelName}`);
    console.error(`Known models: ${known.join(', ')}`);
    process.exit(1);
  }

  const manager = new ModelManager(config.ollama.port, config.ollama.model);
  console.log(`Pulling ${modelName}...`);
  await manager.pullOllamaModel(modelName);
  updateConfig({ ollama: { model: modelName, port: config.ollama.port } });
  console.log(`Switched Ollama model to ${modelName}`);
}

function runUseWhisper(modelName: string): void {
  const config = readConfig();
  const manager = new ModelManager(config.ollama.port, config.ollama.model);

  const entry = manager.validateWhisperModelName(modelName);
  if (!entry) {
    console.error(`Error: Unknown Whisper model: ${modelName}`);
    console.error(`Known models: ${defaults.whisperModels.map((m) => m.name).join(', ')}`);
    process.exit(1);
  }

  manager.downloadWhisperModel(modelName, (msg) => console.log(msg));
  updateConfig({ whisper: { model: modelName, port: config.whisper.port } });
  console.log(`Switched Whisper model to ${modelName}`);
}

async function runModelsUpdate(): Promise<void> {
  const config = readConfig();
  const manager = new ModelManager(config.ollama.port, config.ollama.model);

  console.log(`Updating Whisper model: ${config.whisper.model}`);
  manager.downloadWhisperModel(config.whisper.model, (msg) => console.log(msg));

  console.log(`Updating Ollama model: ${config.ollama.model}`);
  await manager.pullOllamaModel(config.ollama.model);

  console.log('Models updated.');
}

export function registerModels(program: Command): void {
  const cmd = program
    .command('models')
    .description('Manage installed Whisper and Ollama models')
    .action(runModelsList);

  cmd
    .command('use-llm <model>')
    .description('Switch to a different Ollama language model')
    .action(runUseLlm);

  cmd
    .command('use-whisper <model>')
    .description('Switch to a different Whisper model')
    .action(runUseWhisper);

  cmd
    .command('update')
    .description('Re-pull the current Whisper and Ollama models')
    .action(runModelsUpdate);
}
