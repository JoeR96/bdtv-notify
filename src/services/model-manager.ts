import { spawnSync } from 'node:child_process';
import type { WhisperModelEntry } from '../types';
import { OllamaClient } from './ollama-client';
import defaults from '../../config/defaults.json';

export class ModelManager {
  private readonly ollama: OllamaClient;

  constructor(ollamaPort: number, ollamaModel: string) {
    this.ollama = new OllamaClient(ollamaPort, ollamaModel);
  }

  validateWhisperModelName(name: string): WhisperModelEntry | null {
    return (defaults.whisperModels as WhisperModelEntry[]).find((m) => m.name === name) ?? null;
  }

  downloadWhisperModel(modelName: string, onProgress?: (msg: string) => void): void {
    const entry = this.validateWhisperModelName(modelName);
    if (!entry) throw new Error(`Unknown Whisper model: ${modelName}`);

    onProgress?.(`Downloading ${modelName} (${entry.sizeMb} MB)...`);

    const result = spawnSync(
      'docker',
      [
        'run', '--rm',
        '-v', 'bdtv-notify_whisper-models:/models',
        'alpine/curl',
        'curl', '-L', '--progress-bar',
        '-o', `/models/${modelName}.bin`,
        entry.url,
      ],
      { stdio: 'inherit' }
    );

    if (result.status !== 0) {
      throw new Error(`Failed to download Whisper model: ${modelName}`);
    }
  }

  async pullOllamaModel(name: string): Promise<void> {
    await this.ollama.pullModel(name);
  }

  listInstalledWhisperModels(): string[] {
    const result = spawnSync(
      'docker',
      ['run', '--rm', '-v', 'bdtv-notify_whisper-models:/models', 'alpine', 'ls', '/models'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    if (result.status !== 0) return [];

    return result.stdout
      .toString()
      .split('\n')
      .filter((f: string) => f.endsWith('.bin'))
      .map((f: string) => f.replace(/\.bin$/, ''));
  }

  async listInstalledOllamaModels(): Promise<string[]> {
    return this.ollama.listModels();
  }
}
