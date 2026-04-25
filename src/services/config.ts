import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AppConfig } from '../types';
import defaults from '../../config/defaults.json';

const CONFIG_DIR = path.join(os.homedir(), '.bdtv-note-orc');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  whisper: { model: defaults.whisper.model, port: defaults.whisper.port },
  ollama: { model: defaults.ollama.model, port: defaults.ollama.port },
  api: { port: defaults.api.port },
  gpu: { detected: false, type: 'none', device: '' },
  obsidian: { vault: '' },
  prompts: { light: null, deep: null },
};

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideVal = override[key];
    const baseVal = base[key];
    if (
      overrideVal !== null &&
      overrideVal !== undefined &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null
    ) {
      result[key] = deepMerge(baseVal as object, overrideVal as object) as T[keyof T];
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getPidFile(): string {
  return path.join(CONFIG_DIR, 'tidy-api.pid');
}

export function readConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: AppConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const current = readConfig();
  const updated = deepMerge(current, partial);
  writeConfig(updated);
  return updated;
}
