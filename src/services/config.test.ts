import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Use a temp dir for tests so we don't touch the real ~/.bdtv-notify
const testDir = path.join(os.tmpdir(), `olt-test-${Date.now()}`);

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => testDir };
});

// Re-import after mock is set up
let readConfig: typeof import('./config').readConfig;
let writeConfig: typeof import('./config').writeConfig;
let updateConfig: typeof import('./config').updateConfig;

beforeEach(async () => {
  fs.mkdirSync(testDir, { recursive: true });
  // Reset module cache to pick up the mocked homedir
  vi.resetModules();
  const mod = await import('./config');
  readConfig = mod.readConfig;
  writeConfig = mod.writeConfig;
  updateConfig = mod.updateConfig;
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('readConfig', () => {
  it('returns defaults when config file does not exist', () => {
    const config = readConfig();
    expect(config.whisper.model).toBe('ggml-base.en');
    expect(config.ollama.model).toBe('qwen2.5:7b');
    expect(config.gpu.detected).toBe(false);
    expect(config.obsidian.vault).toBe('');
  });

  it('returns defaults when config file has invalid JSON', () => {
    const configDir = path.join(testDir, '.bdtv-notify');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), 'not json', 'utf8');
    const config = readConfig();
    expect(config.whisper.model).toBe('ggml-base.en');
  });
});

describe('writeConfig + readConfig', () => {
  it('round-trips a config correctly', () => {
    const original = readConfig();
    original.obsidian.vault = '/my/vault';
    original.gpu = { detected: true, type: 'nvidia', device: 'RTX 5080' };
    writeConfig(original);

    const loaded = readConfig();
    expect(loaded.obsidian.vault).toBe('/my/vault');
    expect(loaded.gpu.device).toBe('RTX 5080');
    expect(loaded.gpu.type).toBe('nvidia');
  });
});

describe('updateConfig', () => {
  it('merges partial update without losing other fields', () => {
    const base = readConfig();
    base.obsidian.vault = '/initial/vault';
    writeConfig(base);

    const updated = updateConfig({ ollama: { model: 'phi4:14b', port: 11434 } });
    expect(updated.ollama.model).toBe('phi4:14b');
    expect(updated.obsidian.vault).toBe('/initial/vault');
    expect(updated.whisper.model).toBe('ggml-base.en');
  });

  it('persists the partial update to disk', () => {
    updateConfig({ obsidian: { vault: '/persisted/path' } });
    const reloaded = readConfig();
    expect(reloaded.obsidian.vault).toBe('/persisted/path');
  });
});
